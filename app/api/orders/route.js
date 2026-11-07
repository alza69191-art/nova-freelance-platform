import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const result=await query(
      `select o.id,o.service_id,o.buyer_id,o.seller_id,o.package_name,o.package_price,
              o.package_description,o.requirements,o.status,o.due_at,o.created_at,o.updated_at,
              exists(select 1 from service_reviews r where r.order_id=o.id) as reviewed,
              s.title as service_title,
              coalesce(bp.display_name,b.email) as buyer_name,
              coalesce(sp.display_name,su.email) as seller_name
       from service_orders o
       join services s on s.id=o.service_id
       join users b on b.id=o.buyer_id
       join users su on su.id=o.seller_id
       left join profiles bp on bp.user_id=b.id
       left join profiles sp on sp.user_id=su.id
       where o.buyer_id=$1 or o.seller_id=$1
       order by o.created_at desc limit 100`,
      [user.id]
    );
    return NextResponse.json({orders:result.rows});
  } catch(error) {
    console.error("Orders read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل الطلبات."},{status:503});
  }
}

export async function POST(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const serviceId=String(body.serviceId||"");
    const packageName=String(body.packageName||"").trim().slice(0,60);
    const requirements=String(body.requirements||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceId)||
       packageName.length<2||requirements.length<10||requirements.length>5000) {
      return NextResponse.json({error:"اختر باقة واكتب متطلبات المشروع (10 أحرف على الأقل)."}, {status:400});
    }
    const lookup=await query(
      "select id,seller_id,title,packages from services where id=$1 and status='published' limit 1",
      [serviceId]
    );
    const service=lookup.rows[0];
    if(!service) return NextResponse.json({error:"الخدمة غير متاحة حالياً."},{status:404});
    if(service.seller_id===user.id) return NextResponse.json({error:"لا يمكنك طلب خدمتك الخاصة."},{status:400});
    const packages=Array.isArray(service.packages)?service.packages:[];
    const selected=packages.find(item=>String(item.name)===packageName);
    if(!selected) return NextResponse.json({error:"الباقة المختارة غير موجودة. حدّث الصفحة وحاول مجدداً."},{status:400});
    const days=Math.max(1,Math.min(365,Number(selected.deliveryDays)||3));
    const dueAt=new Date(Date.now()+days*86400000);
    const result=await query(
      `insert into service_orders(service_id,buyer_id,seller_id,package_name,package_price,package_description,requirements,due_at)
       values($1,$2,$3,$4,$5,$6,$7,$8)
       returning id,service_id,buyer_id,seller_id,package_name,package_price,package_description,requirements,status,due_at,created_at`,
      [service.id,user.id,service.seller_id,selected.name,selected.price,selected.description||"",requirements,dueAt]
    );
    await query(
      "insert into notifications(user_id,title,body) values($1,$2,$3)",
      [service.seller_id,"طلب خدمة جديد",`لديك طلب جديد على خدمة: ${service.title}`]
    );
    return NextResponse.json({order:result.rows[0],message:"تم إرسال طلبك إلى المستقل. لم يتم خصم أي مبلغ."},{status:201});
  } catch(error) {
    console.error("Order creation failed:",error.message);
    return NextResponse.json({error:"تعذر إنشاء طلب الخدمة."},{status:500});
  }
}

export async function PATCH(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const orderId=String(body.orderId||"");
    const nextStatus=String(body.status||"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)||
       !["accepted","in_progress","delivered","revision_requested","completed","cancelled"].includes(nextStatus)) {
      return NextResponse.json({error:"تحديث الطلب غير صالح."},{status:400});
    }
    const found=await query("select * from service_orders where id=$1 limit 1",[orderId]);
    const order=found.rows[0];
    if(!order) return NextResponse.json({error:"الطلب غير موجود."},{status:404});
    const seller=order.seller_id===user.id;
    const buyer=order.buyer_id===user.id;
    if(!seller&&!buyer) return NextResponse.json({error:"ليس لديك صلاحية تعديل هذا الطلب."},{status:403});
    const transitions=seller
      ? {requested:["accepted","cancelled"],accepted:["in_progress","cancelled"],in_progress:["delivered"],revision_requested:["delivered"]}
      : {requested:["cancelled"],delivered:["revision_requested","completed"]};
    if(!(transitions[order.status]||[]).includes(nextStatus)) {
      return NextResponse.json({error:"لا يمكن تنفيذ هذه الخطوة في حالة الطلب الحالية."},{status:409});
    }
    const updated=await query(
      "update service_orders set status=$2,updated_at=now() where id=$1 returning id,status,updated_at",
      [orderId,nextStatus]
    );
    const recipient=seller?order.buyer_id:order.seller_id;
    const labels={accepted:"تم قبول طلبك",in_progress:"بدأ تنفيذ الطلب",delivered:"تم تسليم العمل",revision_requested:"طلب العميل تعديلات",completed:"اكتمل الطلب",cancelled:"تم إلغاء الطلب"};
    await query("insert into notifications(user_id,title,body) values($1,$2,$3)",[recipient,labels[nextStatus],`تحديث على طلب الخدمة ${orderId.slice(0,8)}`]);
    return NextResponse.json({order:updated.rows[0]});
  } catch(error) {
    console.error("Order update failed:",error.message);
    return NextResponse.json({error:"تعذر تحديث حالة الطلب."},{status:500});
  }
}
