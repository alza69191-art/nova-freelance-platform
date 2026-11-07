import { NextResponse } from "next/server";
import { query } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result=await query(
      `select
        (select count(*)::int from users) as members,
        (select count(*)::int from services where status='published') as services,
        (select count(*)::int from projects where status='open') as open_projects,
        (select count(*)::int from service_orders where status='completed') as completed_orders`
    );
    return NextResponse.json({stats:result.rows[0]||{members:0,services:0,open_projects:0,completed_orders:0}});
  } catch(error) {
    console.error("Platform stats read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل إحصاءات المنصة."},{status:503});
  }
}
