import { NextResponse } from "next/server";
import { getPool, query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""));
}

export async function GET() {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const result=await query(
      `select pr.id,pr.project_id,pr.freelancer_id,pr.cover_letter,pr.bid_amount,pr.delivery_days,pr.status,pr.created_at,
              p.title as project_title,p.client_id,
              coalesce(nullif(fp.display_name,''),fu.email) as freelancer_name,
              coalesce(nullif(cp.display_name,''),cu.email) as client_name
       from project_proposals pr
       join projects p on p.id=pr.project_id
       join users fu on fu.id=pr.freelancer_id
       join users cu on cu.id=p.client_id
       left join profiles fp on fp.user_id=fu.id
       left join profiles cp on cp.user_id=cu.id
       where pr.freelancer_id=$1 or p.client_id=$1
       order by pr.created_at desc limit 100`,
      [user.id]
    );
    return NextResponse.json({proposals:result.rows});
  } catch(error) {
    console.error("Project proposals read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل عروض المشاريع."},{status:503});
  }
}

export async function POST(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const projectId=String(body.projectId||"");
    const coverLetter=String(body.coverLetter||"").trim();
    const bidAmount=Number(body.bidAmount);
    const deliveryDays=Number(body.deliveryDays);
    if(!validId(projectId)||coverLetter.length<20||coverLetter.length>4000||
       !Number.isFinite(bidAmount)||bidAmount<0||bidAmount>100000000||
       !Number.isInteger(deliveryDays)||deliveryDays<1||deliveryDays>365) {
      return NextResponse.json({error:"اكتب عرضاً من 20 حرفاً على الأقل وحدد السعر ومدة التنفيذ."},{status:400});
    }
    const projectResult=await query("select id,client_id,title,status from projects where id=$1 limit 1",[projectId]);
    const project=projectResult.rows[0];
    if(!project||project.status!=="open") return NextResponse.json({error:"المشروع غير متاح لاستقبال العروض."},{status:404});
    if(project.client_id===user.id) return NextResponse.json({error:"لا يمكنك تقديم عرض على مشروعك الخاص."},{status:400});
    const created=await query(
      `insert into project_proposals(project_id,freelancer_id,cover_letter,bid_amount,delivery_days)
       values($1,$2,$3,$4,$5)
       on conflict(project_id,freelancer_id) do nothing
       returning id,project_id,freelancer_id,cover_letter,bid_amount,delivery_days,status,created_at`,
      [projectId,user.id,coverLetter,bidAmount,deliveryDays]
    );
    if(!created.rowCount) return NextResponse.json({error:"سبق أن قدمت عرضاً على هذا المشروع."},{status:409});
    await query(
      "insert into notifications(user_id,title,body) values($1,$2,$3)",
      [project.client_id,"عرض جديد على مشروعك",`وصل عرض جديد على مشروع: ${project.title}`]
    );
    return NextResponse.json({proposal:created.rows[0]},{status:201});
  } catch(error) {
    console.error("Project proposal create failed:",error.message);
    return NextResponse.json({error:"تعذر إرسال العرض."},{status:500});
  }
}

export async function PATCH(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const proposalId=String(body.proposalId||"");
    const status=String(body.status||"");
    if(!validId(proposalId)||!["accepted","rejected"].includes(status)) return NextResponse.json({error:"تحديث العرض غير صالح."},{status:400});
    const client=await getPool().connect();
    let updated;
    let selected;
    try {
      await client.query("begin");
      const found=await client.query(
        `select pr.id,pr.status,pr.project_id,pr.freelancer_id,p.client_id,p.title,p.status as project_status
         from project_proposals pr join projects p on p.id=pr.project_id where pr.id=$1 for update of pr,p`,
        [proposalId]
      );
      selected=found.rows[0];
      if(!selected){await client.query("rollback");return NextResponse.json({error:"العرض غير موجود."},{status:404});}
      if(selected.client_id!==user.id){await client.query("rollback");return NextResponse.json({error:"صاحب المشروع فقط يستطيع اختيار العرض."},{status:403});}
      if(selected.status!=="pending"||selected.project_status!=="open"){await client.query("rollback");return NextResponse.json({error:"لم يعد هذا العرض متاحاً للاختيار."},{status:409});}
      updated=await client.query("update project_proposals set status=$2 where id=$1 returning id,status",[proposalId,status]);
      if(status==="accepted") {
        await client.query("update projects set status='in_progress' where id=$1",[selected.project_id]);
        await client.query("update project_proposals set status='rejected' where project_id=$1 and id<>$2 and status='pending'",[selected.project_id,proposalId]);
      }
      await client.query(
        "insert into notifications(user_id,title,body) values($1,$2,$3)",
        [selected.freelancer_id,status==="accepted"?"تم قبول عرضك":"تم رفض عرضك",`تم تحديث عرضك على مشروع: ${selected.title}`]
      );
      await client.query("commit");
    } catch(error){await client.query("rollback");throw error;}
    finally{client.release();}
    return NextResponse.json({proposal:updated.rows[0]});
  } catch(error) {
    console.error("Project proposal update failed:",error.message);
    return NextResponse.json({error:"تعذر تحديث العرض."},{status:500});
  }
}
