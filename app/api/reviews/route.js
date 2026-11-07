import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""));
}

export async function GET(request) {
  try {
    const serviceId=String(new URL(request.url).searchParams.get("serviceId")||"");
    if(!validId(serviceId)) return NextResponse.json({error:"الخدمة غير صالحة."},{status:400});
    const result=await query(
      `select r.id,r.rating,r.comment,r.created_at,
              coalesce(nullif(p.display_name,''),'عميل NOVA') as reviewer_name
       from service_reviews r left join profiles p on p.user_id=r.buyer_id
       where r.service_id=$1 order by r.created_at desc limit 50`,
      [serviceId]
    );
    return NextResponse.json({reviews:result.rows});
  } catch(error) {
    console.error("Service reviews read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل التقييمات."},{status:503});
  }
}

export async function POST(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const orderId=String(body.orderId||"");
    const rating=Number(body.rating);
    const comment=String(body.comment||"").trim();
    if(!validId(orderId)||!Number.isInteger(rating)||rating<1||rating>5||comment.length<3||comment.length>1000) {
      return NextResponse.json({error:"اختر تقييماً من نجمة إلى خمس نجوم واكتب تعليقاً من 3 إلى 1000 حرف."},{status:400});
    }
    const orderResult=await query(
      "select id,service_id,buyer_id,seller_id,status from service_orders where id=$1 limit 1",
      [orderId]
    );
    const order=orderResult.rows[0];
    if(!order) return NextResponse.json({error:"الطلب غير موجود."},{status:404});
    if(order.buyer_id!==user.id) return NextResponse.json({error:"العميل صاحب الطلب فقط يستطيع التقييم."},{status:403});
    if(order.status!=="completed") return NextResponse.json({error:"يمكن تقييم الخدمة بعد اكتمال الطلب فقط."},{status:409});
    const result=await query(
      `insert into service_reviews(order_id,service_id,buyer_id,seller_id,rating,comment)
       values($1,$2,$3,$4,$5,$6)
       on conflict(order_id) do nothing
       returning id,rating,comment,created_at`,
      [order.id,order.service_id,user.id,order.seller_id,rating,comment]
    );
    if(!result.rowCount) return NextResponse.json({error:"تم تقييم هذا الطلب مسبقاً."},{status:409});
    await query(
      "insert into notifications(user_id,title,body) values($1,$2,$3)",
      [order.seller_id,"تقييم جديد لخدمتك",`حصلت على تقييم ${rating}/5 بعد اكتمال طلب.`]
    );
    return NextResponse.json({review:result.rows[0]},{status:201});
  } catch(error) {
    console.error("Service review create failed:",error.message);
    return NextResponse.json({error:"تعذر حفظ التقييم."},{status:500});
  }
}
