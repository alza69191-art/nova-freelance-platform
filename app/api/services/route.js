import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await query(
      `select s.id,s.title,s.description,s.category,s.price,s.created_at,
              p.display_name as seller_name
       from services s left join profiles p on p.user_id=s.seller_id
       where s.status='published'
       order by s.created_at desc limit 100`
    );
    return NextResponse.json({ services: result.rows });
  } catch (error) {
    console.error("Services query failed:", error.message);
    return NextResponse.json({ error: "تعذر تحميل الخدمات." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
    const body = await request.json();
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const category = String(body.category || "").trim();
    const price = Number(body.price);
    if (title.length < 5 || title.length > 120 || description.length < 20 || description.length > 10000 || !category || category.length > 80 || !Number.isFinite(price) || price < 0 || price > 100000000) {
      return NextResponse.json({ error: "تحقق من عنوان الخدمة ووصفها وتصنيفها وسعرها." }, { status: 400 });
    }
    const result = await query(
      `insert into services(seller_id,title,description,category,price,status)
       values($1,$2,$3,$4,$5,'draft')
       returning id,title,description,category,price,status,created_at`,
      [user.id,title,description,category,price]
    );
    return NextResponse.json({ service: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Service creation failed:", error.message);
    return NextResponse.json({ error: "تعذر إنشاء الخدمة." }, { status: 500 });
  }
}
