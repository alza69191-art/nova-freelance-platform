import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
    const body = await request.json();
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
    if (subject.length < 4 || subject.length > 160 || message.length < 10 || message.length > 5000) {
      return NextResponse.json({ error: "اكتب عنواناً ورسالة واضحة (10 أحرف على الأقل)." }, { status: 400 });
    }
    const result = await query(
      `with ticket as (
         insert into support_tickets(user_id,subject)
         values($1,$2) returning id,user_id,subject,status,created_at
       ), first_message as (
         insert into support_messages(ticket_id,sender_id,message)
         select id,$1,$3 from ticket returning ticket_id
       )
       select ticket.* from ticket join first_message on first_message.ticket_id=ticket.id`,
      [user.id,subject,message]
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Support ticket creation failed:", error.message);
    return NextResponse.json({ error: "تعذر إرسال رسالة الدعم." }, { status: 500 });
  }
}
