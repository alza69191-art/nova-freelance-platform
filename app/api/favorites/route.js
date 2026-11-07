import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
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
      `select s.id,s.title,s.description,s.category,s.price,s.packages,s.extras,
              coalesce(nullif(p.display_name,''),'مستقل NOVA') as seller_name,
              (select m.id from service_media m where m.service_id=s.id order by m.sort_order,m.created_at limit 1) as cover_id,
              coalesce((select round(avg(r.rating)::numeric,2) from service_reviews r where r.service_id=s.id),0) as rating,
              (select count(*)::int from service_reviews r where r.service_id=s.id) as review_count
       from favorite_services f
       join services s on s.id=f.service_id
       left join profiles p on p.user_id=s.seller_id
       where f.user_id=$1 and s.status='published'
       order by f.created_at desc limit 100`,
      [user.id]
    );
    return NextResponse.json({favorites:result.rows});
  } catch(error) {
    console.error("Favorites read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل المفضلة."},{status:503});
  }
}

export async function POST(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const serviceId=String(body.serviceId||"");
    const favorite=body.favorite===true;
    if(!validId(serviceId)) return NextResponse.json({error:"الخدمة غير صالحة."},{status:400});
    if(favorite) {
      const result=await query("select id from services where id=$1 and status='published' limit 1",[serviceId]);
      if(!result.rowCount) return NextResponse.json({error:"الخدمة غير متاحة."},{status:404});
      await query("insert into favorite_services(user_id,service_id) values($1,$2) on conflict do nothing",[user.id,serviceId]);
    } else {
      await query("delete from favorite_services where user_id=$1 and service_id=$2",[user.id,serviceId]);
    }
    return NextResponse.json({ok:true,favorite});
  } catch(error) {
    console.error("Favorite update failed:",error.message);
    return NextResponse.json({error:"تعذر تحديث المفضلة."},{status:500});
  }
}
