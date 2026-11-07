import { NextResponse } from "next/server";
import { getPool, query } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 22 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 14 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const USER_QUOTA_BYTES = 100 * 1024 * 1024;
const GLOBAL_CHAT_QUOTA_BYTES = 250 * 1024 * 1024;
const PUBLIC_CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const sendTimes = new Map();

function safeFilename(name) {
  const cleaned = String(name || "file").replaceAll("/", "_").replaceAll(String.fromCharCode(92), "_").replace(/[\x00-\x1f\x7f]/g, "_").trim().slice(0, 160);
  return cleaned || "file";
}

function extension(name) {
  return name.toLowerCase().split(".").pop() || "";
}

async function inspectFile(file) {
  const ext = extension(file.name);
  const data = Buffer.from(await file.arrayBuffer());
  let mime = "";

  const starts = (...bytes) => bytes.every((value, index) => data[index] === value);
  const textSample = data.subarray(0, Math.min(data.length, 2048));
  const hasNul = textSample.includes(0);

  if (ext === "jpg" || ext === "jpeg") {
    if (starts(0xff, 0xd8, 0xff)) mime = "image/jpeg";
  } else if (ext === "png") {
    if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = "image/png";
  } else if (ext === "gif") {
    const signature = data.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") mime = "image/gif";
  } else if (ext === "webp") {
    if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") mime = "image/webp";
  } else if (["mp4", "m4v", "mov"].includes(ext)) {
    if (data.subarray(4, 8).toString("ascii") === "ftyp") mime = ext === "mov" ? "video/quicktime" : "video/mp4";
  } else if (ext === "webm") {
    if (data.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) mime = "video/webm";
  } else if (ext === "pdf") {
    if (data.subarray(0, 5).toString("ascii") === "%PDF-") mime = "application/pdf";
  } else if (["docx", "xlsx", "pptx"].includes(ext)) {
    if (data.subarray(0, 2).toString("ascii") === "PK") {
      mime = ext === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : ext === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }
  } else if (ext === "txt" || ext === "csv") {
    try {
      if (!hasNul) {
        new TextDecoder("utf-8", { fatal: true }).decode(data);
        mime = ext === "csv" ? "text/csv" : "text/plain";
      }
    } catch {}
  }

  if (!mime) throw new Error("نوع الملف غير مدعوم أو أن محتواه لا يطابق امتداده.");
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const maxBytes = isImage ? MAX_IMAGE_BYTES : isVideo ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES;
  if (!data.length || data.length > maxBytes) {
    throw new Error(isImage ? "حجم الصورة يتجاوز 8 ميغابايت." : isVideo ? "حجم الفيديو يتجاوز 14 ميغابايت." : "حجم الملف يتجاوز 8 ميغابايت.");
  }
  return { data, mime, fileName: safeFilename(file.name) };
}

function allowedToSend(userId) {
  const now = Date.now();
  const recent = (sendTimes.get(userId) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  sendTimes.set(userId, recent);
  return true;
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "سجّل الدخول لإرسال الرسائل." }, { status: 401 });
    if (!allowedToSend(user.id)) return NextResponse.json({ error: "أرسلت رسائل كثيرة خلال دقيقة. حاول بعد قليل." }, { status: 429 });

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "حجم الإرسال أكبر من الحد المسموح (20 ميغابايت)." }, { status: 413 });

    const form = await request.formData();
    const conversationId = String(form.get("conversationId") || "");
    const body = String(form.get("message") || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
      return NextResponse.json({ error: "المحادثة غير صالحة." }, { status: 400 });
    }
    if (body.length > 5000) return NextResponse.json({ error: "الرسالة تتجاوز 5000 حرف." }, { status: 400 });

    const conversationResult = await query(
      "select id,conversation_type,participant_one_id,participant_two_id from conversations where id=$1 limit 1",
      [conversationId]
    );
    const conversation = conversationResult.rows[0];
    if (!conversation) return NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 });
    if (conversation.conversation_type === "direct" &&
        conversation.participant_one_id !== user.id && conversation.participant_two_id !== user.id) {
      return NextResponse.json({ error: "ليس لديك صلاحية الإرسال في هذه المحادثة." }, { status: 403 });
    }
    if (conversation.conversation_type === "public" && conversation.id !== PUBLIC_CONVERSATION_ID) {
      return NextResponse.json({ error: "هذه المساحة العامة غير معتمدة." }, { status: 403 });
    }

    const incomingFiles = form.getAll("files").filter((value) => value && typeof value.arrayBuffer === "function");
    if (!body && incomingFiles.length === 0) return NextResponse.json({ error: "اكتب رسالة أو أرفق ملفاً." }, { status: 400 });
    if (incomingFiles.length > 4) return NextResponse.json({ error: "يمكن إرفاق 4 ملفات كحد أقصى في الرسالة." }, { status: 400 });

    const files = [];
    let totalBytes = 0;
    try {
      for (const file of incomingFiles) {
        const item = await inspectFile(file);
        totalBytes += item.data.length;
        if (totalBytes > MAX_TOTAL_FILE_BYTES) throw new Error("مجموع المرفقات يتجاوز 20 ميغابايت.");
        files.push(item);
      }
    } catch (error) {
      return NextResponse.json({ error: error.message || "تعذر التحقق من المرفقات." }, { status: 400 });
    }

    if (totalBytes) {
      const usage = await query(
        `select coalesce(sum(size_bytes),0)::bigint as total_used,
                coalesce(sum(size_bytes) filter (where uploaded_by=$1),0)::bigint as user_used
         from chat_attachments`,
        [user.id]
      );
      if (Number(usage.rows[0]?.user_used || 0) + totalBytes > USER_QUOTA_BYTES) {
        return NextResponse.json({ error: "وصلت إلى حصة الملفات الخاصة بحسابك (100 ميغابايت)." }, { status: 413 });
      }
      if (Number(usage.rows[0]?.total_used || 0) + totalBytes > GLOBAL_CHAT_QUOTA_BYTES) {
        return NextResponse.json({ error: "وصلت مساحة ملفات المحادثات إلى الحد التجريبي (250 ميغابايت). تواصل مع الإدارة لزيادة السعة." }, { status: 413 });
      }
    }

    await query("select 1");
    const client = await getPool().connect();
    let message;
    try {
      await client.query("begin");
      const inserted = await client.query(
        "insert into conversation_messages(conversation_id,sender_id,body) values($1,$2,$3) returning id,conversation_id,body,created_at,sender_id",
        [conversationId, user.id, body]
      );
      message = inserted.rows[0];
      for (const file of files) {
        await client.query(
          "insert into chat_attachments(message_id,uploaded_by,file_name,mime_type,size_bytes,data) values($1,$2,$3,$4,$5,$6)",
          [message.id, user.id, file.fileName, file.mime, file.data.length, file.data]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true, messageId: message.id }, { status: 201 });
  } catch (error) {
    console.error("Chat message send failed:", error.message);
    return NextResponse.json({ error: "تعذر إرسال الرسالة حالياً." }, { status: 500 });
  }
}
