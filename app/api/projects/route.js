import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await query(
      `select p.id,p.title,p.description,p.category,p.budget_min,p.budget_max,p.created_at,
              pr.display_name as client_name
       from projects p left join profiles pr on pr.user_id=p.client_id
       where p.status='open' order by p.created_at desc limit 100`
    );
    return NextResponse.json({ projects: result.rows });
  } catch (error) {
    console.error("Projects query failed:", error.message);
    return NextResponse.json({ error: "تعذر تحميل المشاريع." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
    const body = await request.json();
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const category = String(body.category || "عام").trim();
    const min = body.budgetMin == null || body.budgetMin === "" ? null : Number(body.budgetMin);
    const max = body.budgetMax == null || body.budgetMax === "" ? null : Number(body.budgetMax);
    if (title.length < 5 || title.length > 160 || description.length < 20 || description.length > 12000 || !category || category.length > 80 || (min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0)) || (min !== null && max !== null && max < min)) {
      return NextResponse.json({ error: "تحقق من بيانات المشروع والميزانية." }, { status: 400 });
    }
    const result = await query(
      `insert into projects(client_id,title,description,category,budget_min,budget_max)
       values($1,$2,$3,$4,$5,$6)
       returning id,title,description,category,budget_min,budget_max,status,created_at`,
      [user.id,title,description,category,min,max]
    );
    return NextResponse.json({ project: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Project creation failed:", error.message);
    return NextResponse.json({ error: "تعذر نشر المشروع." }, { status: 500 });
  }
}
