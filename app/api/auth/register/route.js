import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { createSession, hashPassword } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim().slice(0, 80);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: "البريد الإلكتروني غير صالح." }, { status: 400 });
    }
    if (password.length < 12 || password.length > 128) {
      return NextResponse.json({ error: "كلمة المرور يجب أن تكون 12 حرفاً على الأقل." }, { status: 400 });
    }
    if (!displayName) {
      return NextResponse.json({ error: "أدخل الاسم الظاهر." }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);
    const result = await query(
      `with new_user as (
         insert into users(email,password_hash) values($1,$2)
         returning id,email,role
       )
       insert into profiles(user_id,display_name)
       select id,$3 from new_user
       returning user_id`,
      [email, passwordHash, displayName]
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) throw new Error("Could not create user profile.");
    await createSession(userId);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "هذا البريد مسجل بالفعل." }, { status: 409 });
    }
    console.error("Registration failed:", error.message);
    return NextResponse.json({ error: "تعذر إنشاء الحساب حالياً." }, { status: 500 });
  }
}
