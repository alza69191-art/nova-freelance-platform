import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    const mine = new URL(request.url).searchParams.get("mine") === "1";
    if (mine && !user) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
    const result = await query(
      `select p.id,p.client_id,p.title,p.description,p.category,p.budget_min,p.budget_max,p.status,p.created_at,
              pr.display_name as client_name,
              (select count(*)::int from project_proposals pp where pp.project_id=p.id) as proposal_count
       from projects p left join profiles pr on pr.user_id=p.client_id
       where ${mine ? "p.client_id=$1" : "p.status='open'"}
       order by p.created_at desc limit 100`,
      mine ? [user.id] : []
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

export async function PATCH(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
    const body = await request.json();
    const projectId = String(body.projectId || "");
    const status = String(body.status || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId) ||
        !["completed", "cancelled", "open"].includes(status)) {
      return NextResponse.json({ error: "تحديث المشروع غير صالح." }, { status: 400 });
    }
    const found = await query("select id,status,title from projects where id=$1 and client_id=$2 limit 1", [projectId,user.id]);
    const project = found.rows[0];
    if (!project) return NextResponse.json({ error: "المشروع غير موجود أو لا تملك صلاحية تعديله." }, { status: 404 });
    const allowed = project.status === "in_progress" && status === "completed" ||
      project.status === "open" && status === "cancelled" ||
      project.status === "cancelled" && status === "open";
    if (!allowed) return NextResponse.json({ error: "لا يمكن تغيير المشروع من حالته الحالية إلى هذه الحالة." }, { status: 409 });
    const updated = await query("update projects set status=$2 where id=$1 returning id,status", [projectId,status]);
    if (status === "completed") {
      const recipients = await query(
        "select distinct freelancer_id from project_proposals where project_id=$1 and status='accepted'",
        [projectId]
      );
      for (const recipient of recipients.rows) {
        await query("insert into notifications(user_id,title,body) values($1,$2,$3)", [recipient.freelancer_id,"اكتمل المشروع",`أعلن العميل اكتمال المشروع: ${project.title}`]);
      }
    }
    return NextResponse.json({ project: updated.rows[0] });
  } catch (error) {
    console.error("Project status update failed:", error.message);
    return NextResponse.json({ error: "تعذر تحديث المشروع." }, { status: 500 });
  }
}
