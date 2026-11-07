import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { createSession, verifyPassword } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password || email.length > 254 || password.length > 128) {
      return NextResponse.json({ error: "بيانات الدخول غير صحيحة." }, { status: 400 });
    }
    const result = await query("select id,password_hash from users where email=$1 limit 1", [email]);
    const user = result.rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) {
      return NextResponse.json({ error: "البريد أو كلمة المرور غير صحيحة." }, { status: 401 });
    }
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Login failed:", error.message);
    return NextResponse.json({ error: "تعذر تسجيل الدخول حالياً." }, { status: 500 });
  }
}
