import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

const PUBLIC_CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";

async function canReadConversation(conversationId, user) {
  const result = await query(
    "select id, conversation_type, participant_one_id, participant_two_id from conversations where id=$1 limit 1",
    [conversationId]
  );
  const conversation = result.rows[0];
  if (!conversation) return null;
  if (conversation.conversation_type === "public") return conversation;
  if (!user) return null;
  if (conversation.participant_one_id !== user.id && conversation.participant_two_id !== user.id) return null;
  return conversation;
}

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "public";

    if (scope === "public") {
      const conversation = await canReadConversation(PUBLIC_CONVERSATION_ID, null);
      if (!conversation) return NextResponse.json({ error: "مساحة التواصل العامة غير متاحة." }, { status: 503 });
      const result = await query(
        `select m.id, m.conversation_id, m.body, m.created_at, m.sender_id,
                coalesce(p.display_name, 'عضو NOVA') as sender_name,
                coalesce((
                  select json_agg(json_build_object(
                    'id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes
                  ) order by a.created_at)
                  from chat_attachments a where a.message_id=m.id
                ), '[]'::json) as attachments
         from (
           select * from conversation_messages
           where conversation_id=$1
           order by created_at desc limit 60
         ) m
         left join profiles p on p.user_id=m.sender_id
         order by m.created_at asc`,
        [PUBLIC_CONVERSATION_ID]
      );
      return NextResponse.json({ conversationId: PUBLIC_CONVERSATION_ID, messages: result.rows });
    }

    if (!user) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });

    if (scope === "private") {
      const result = await query(
        `select c.id, other.id as other_user_id,
                coalesce(nullif(p.display_name,''), 'عضو NOVA') as other_user_name,
                lm.body as last_message, lm.created_at as last_message_at
         from conversations c
         join users other on other.id = case when c.participant_one_id=$1 then c.participant_two_id else c.participant_one_id end
         left join profiles p on p.user_id=other.id
         left join lateral (
           select body, created_at from conversation_messages
           where conversation_id=c.id order by created_at desc limit 1
         ) lm on true
         where c.conversation_type='direct'
           and (c.participant_one_id=$1 or c.participant_two_id=$1)
         order by lm.created_at desc nulls last, c.created_at desc
         limit 100`,
        [user.id]
      );
      return NextResponse.json({ conversations: result.rows });
    }

    if (scope === "people") {
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
      if (q.length < 2) return NextResponse.json({ people: [] });
      const result = await query(
        `select u.id, coalesce(nullif(p.display_name,''), 'عضو NOVA') as display_name
         from profiles p join users u on u.id=p.user_id
         where u.id<>$1 and p.display_name ilike $2
         order by p.display_name limit 15`,
        [user.id, `%${q.replace(/[\\\\%_]/g, "\\\\$&")}%`]
      );
      return NextResponse.json({ people: result.rows });
    }

    if (scope === "messages") {
      const conversationId = String(url.searchParams.get("conversationId") || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
        return NextResponse.json({ error: "معرّف المحادثة غير صالح." }, { status: 400 });
      }
      const conversation = await canReadConversation(conversationId, user);
      if (!conversation) return NextResponse.json({ error: "المحادثة غير موجودة أو ليس لديك صلاحية الوصول." }, { status: 404 });
      const result = await query(
        `select m.id, m.conversation_id, m.body, m.created_at, m.sender_id,
                coalesce(p.display_name, 'عضو NOVA') as sender_name,
                coalesce((
                  select json_agg(json_build_object(
                    'id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes
                  ) order by a.created_at)
                  from chat_attachments a where a.message_id=m.id
                ), '[]'::json) as attachments
         from (
           select * from conversation_messages
           where conversation_id=$1
           order by created_at desc limit 80
         ) m
         left join profiles p on p.user_id=m.sender_id
         order by m.created_at asc`,
        [conversationId]
      );
      return NextResponse.json({ conversationId, messages: result.rows });
    }

    return NextResponse.json({ error: "طلب غير معروف." }, { status: 400 });
  } catch (error) {
    console.error("Communication read failed:", error.message);
    return NextResponse.json({ error: "تعذر تحميل المحادثات." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
    const body = await request.json();
    const recipientId = String(body.recipientId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipientId) || recipientId === user.id) {
      return NextResponse.json({ error: "اختر عضواً صالحاً لبدء المحادثة." }, { status: 400 });
    }
    const result = await query(
      `insert into conversations(conversation_type, participant_one_id, participant_two_id)
       values('direct', least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid))
       on conflict(participant_one_id,participant_two_id)
       do update set participant_one_id=excluded.participant_one_id
       returning id`,
      [user.id, recipientId]
    );
    return NextResponse.json({ conversationId: result.rows[0].id }, { status: 201 });
  } catch (error) {
    if (error.code === "23503") return NextResponse.json({ error: "هذا العضو غير موجود." }, { status: 404 });
    console.error("Private conversation creation failed:", error.message);
    return NextResponse.json({ error: "تعذر بدء المحادثة الخاصة." }, { status: 500 });
  }
}
