import { NextResponse } from "next/server";
import { getPool, query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""));
}

export async function GET(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const isAdmin=user.role==="admin";
    const url=new URL(request.url);
    const ticketId=url.searchParams.get("ticketId");
    if(ticketId) {
      if(!validId(ticketId)) return NextResponse.json({error:"رقم التذكرة غير صالح."},{status:400});
      const ticketResult=await query(
        `select t.id,t.user_id,t.subject,t.status,t.created_at,t.updated_at,
                coalesce(nullif(p.display_name,''),u.email) as customer_name
         from support_tickets t join users u on u.id=t.user_id
         left join profiles p on p.user_id=u.id
         where t.id=$1 and ($2::boolean or t.user_id=$3) limit 1`,
        [ticketId,isAdmin,user.id]
      );
      const ticket=ticketResult.rows[0];
      if(!ticket) return NextResponse.json({error:"التذكرة غير موجودة."},{status:404});
      const messages=await query(
        `select m.id,m.sender_id,m.message,m.created_at,
                coalesce(nullif(p.display_name,''),u.email) as sender_name,
                u.role as sender_role
         from support_messages m join users u on u.id=m.sender_id
         left join profiles p on p.user_id=u.id
         where m.ticket_id=$1 order by m.created_at asc`,
        [ticketId]
      );
      return NextResponse.json({ticket,messages:messages.rows});
    }
    const tickets=await query(
      `select t.id,t.user_id,t.subject,t.status,t.created_at,t.updated_at,
              coalesce(nullif(p.display_name,''),u.email) as customer_name,
              lm.message as last_message,lm.created_at as last_message_at
       from support_tickets t join users u on u.id=t.user_id
       left join profiles p on p.user_id=u.id
       left join lateral (
         select message,created_at from support_messages where ticket_id=t.id order by created_at desc limit 1
       ) lm on true
       where ($1::boolean or t.user_id=$2)
       order by t.updated_at desc limit 100`,
      [isAdmin,user.id]
    );
    return NextResponse.json({tickets:tickets.rows,isAdmin});
  } catch(error) {
    console.error("Support inbox read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل صندوق الدعم."},{status:503});
  }
}

export async function POST(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const ticketId=String(body.ticketId||"");
    const subject=String(body.subject||"").trim();
    const message=String(body.message||"").trim();
    if(message.length<2||message.length>5000) return NextResponse.json({error:"اكتب رسالة من حرفين إلى 5000 حرف."},{status:400});

    if(!ticketId) {
      if(user.role==="admin") return NextResponse.json({error:"اختر تذكرة للرد عليها."},{status:400});
      if(subject.length<4||subject.length>160) return NextResponse.json({error:"اكتب عنواناً واضحاً من 4 إلى 160 حرفاً."},{status:400});
      const client=await getPool().connect();
      let ticket;
      try {
        await client.query("begin");
        const created=await client.query(
          "insert into support_tickets(user_id,subject) values($1,$2) returning id,subject,status,created_at",
          [user.id,subject]
        );
        ticket=created.rows[0];
        await client.query("insert into support_messages(ticket_id,sender_id,message) values($1,$2,$3)",[ticket.id,user.id,message]);
        await client.query(
          `insert into notifications(user_id,title,body)
           select id,'تذكرة دعم جديدة',$1 from users where role='admin'`,
          [`وصلت تذكرة دعم جديدة: ${subject}`]
        );
        await client.query("commit");
      } catch(error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
      return NextResponse.json({ticket},{status:201});
    }

    if(!validId(ticketId)) return NextResponse.json({error:"رقم التذكرة غير صالح."},{status:400});
    const found=await query("select id,user_id,status from support_tickets where id=$1 limit 1",[ticketId]);
    const ticket=found.rows[0];
    if(!ticket) return NextResponse.json({error:"التذكرة غير موجودة."},{status:404});
    const isAdmin=user.role==="admin";
    if(!isAdmin&&ticket.user_id!==user.id) return NextResponse.json({error:"ليس لديك صلاحية الرد على هذه التذكرة."},{status:403});
    if(ticket.status==="closed") return NextResponse.json({error:"هذه التذكرة مغلقة. افتح تذكرة جديدة لمتابعة الموضوع."},{status:409});
    const client=await getPool().connect();
    try {
      await client.query("begin");
      await client.query("insert into support_messages(ticket_id,sender_id,message) values($1,$2,$3)",[ticketId,user.id,message]);
      await client.query(
        "update support_tickets set status=$2,updated_at=now() where id=$1",
        [ticketId,isAdmin?"answered":"open"]
      );
      const recipient=isAdmin?ticket.user_id:null;
      if(recipient) await client.query(
        "insert into notifications(user_id,title,body) values($1,$2,$3)",
        [recipient,"رد جديد من دعم NOVA", "تم الرد على تذكرة الدعم الخاصة بك."]
      );
      if(!isAdmin) {
        await client.query(
          `insert into notifications(user_id,title,body)
           select id,'رسالة دعم جديدة',$1 from users where role='admin'`,
          [`وصل رد جديد على تذكرة: ${ticketId.slice(0,8)}`]
        );
      }
      await client.query("commit");
    } catch(error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    return NextResponse.json({ok:true});
  } catch(error) {
    console.error("Support message save failed:",error.message);
    return NextResponse.json({error:"تعذر حفظ رسالة الدعم."},{status:500});
  }
}

export async function PATCH(request) {
  try {
    const user=await getCurrentUser();
    if(!user||user.role!=="admin") return NextResponse.json({error:"هذه العملية متاحة للإدارة فقط."},{status:403});
    const body=await request.json();
    const ticketId=String(body.ticketId||"");
    const status=String(body.status||"");
    if(!validId(ticketId)||!["open","in_progress","answered","closed"].includes(status)) return NextResponse.json({error:"تحديث التذكرة غير صالح."},{status:400});
    const updated=await query(
      "update support_tickets set status=$2,updated_at=now() where id=$1 returning id,status",
      [ticketId,status]
    );
    if(!updated.rowCount) return NextResponse.json({error:"التذكرة غير موجودة."},{status:404});
    return NextResponse.json({ticket:updated.rows[0]});
  } catch(error) {
    console.error("Support status update failed:",error.message);
    return NextResponse.json({error:"تعذر تحديث حالة التذكرة."},{status:500});
  }
}
