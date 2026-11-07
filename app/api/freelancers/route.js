import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const q=String(new URL(request.url).searchParams.get("q")||"").trim().slice(0,80);
    const result=await query(
      `select u.id,p.display_name,p.bio,p.skills,p.avatar_url,
              count(distinct s.id)::int as published_services,
              coalesce(round(avg(r.rating)::numeric,2),0) as rating,
              count(distinct r.id)::int as review_count
       from profiles p join users u on u.id=p.user_id
       left join services s on s.seller_id=u.id and s.status='published'
       left join service_reviews r on r.seller_id=u.id
       where ($1='' or p.display_name ilike $2 or p.bio ilike $2 or array_to_string(p.skills,' ') ilike $2)
       group by u.id,p.display_name,p.bio,p.skills,p.avatar_url
       order by published_services desc,rating desc,p.display_name asc limit 60`,
      [q,q?"%"+q+"%":""]
    );
    return NextResponse.json({freelancers:result.rows});
  } catch(error) {
    console.error("Freelancer directory failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل دليل المستقلين."},{status:503});
  }
}

export async function PATCH(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const displayName=String(body.displayName||"").trim().slice(0,80);
    const bio=String(body.bio||"").trim().slice(0,1200);
    const skills=Array.isArray(body.skills)
      ? [...new Set(body.skills.map(x=>String(x).trim().slice(0,40)).filter(Boolean))].slice(0,20)
      : [];
    if(displayName.length<2||bio.length>1200) return NextResponse.json({error:"أدخل اسماً صحيحاً ونبذة لا تتجاوز 1200 حرف."},{status:400});
    const result=await query(
      `insert into profiles(user_id,display_name,bio,skills)
       values($1,$2,$3,$4)
       on conflict(user_id) do update set display_name=excluded.display_name,bio=excluded.bio,skills=excluded.skills
       returning user_id,display_name,bio,skills`,
      [user.id,displayName,bio,skills]
    );
    return NextResponse.json({profile:result.rows[0]});
  } catch(error) {
    console.error("Freelancer profile update failed:",error.message);
    return NextResponse.json({error:"تعذر حفظ الملف المهني."},{status:500});
  }
}
