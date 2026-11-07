import { NextResponse } from "next/server";
import { query } from "../../../../../lib/db";
import { getCurrentUser } from "../../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ""))) {
      return NextResponse.json({ error: "الملف غير موجود." }, { status: 404 });
    }

    const user = await getCurrentUser();
    const result = await query(
      `select a.file_name,a.mime_type,a.size_bytes,a.data,c.conversation_type,
              c.participant_one_id,c.participant_two_id
       from chat_attachments a
       join conversation_messages m on m.id=a.message_id
       join conversations c on c.id=m.conversation_id
       where a.id=$1 limit 1`,
      [id]
    );
    const file = result.rows[0];
    if (!file) return NextResponse.json({ error: "الملف غير موجود." }, { status: 404 });
    if (file.conversation_type === "direct" &&
        (!user || (file.participant_one_id !== user.id && file.participant_two_id !== user.id))) {
      return NextResponse.json({ error: "ليس لديك صلاحية الوصول إلى هذا الملف." }, { status: 403 });
    }

    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const size = data.length;
    const inline = file.mime_type.startsWith("image/");
    const disposition = inline ? "inline" : "attachment";
    const encodedName = encodeURIComponent(file.file_name).replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
    const headers = {
      "Content-Type": file.mime_type,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
    };

    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match || (!match[1] && !match[2])) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      let end = match[2] && match[1] ? Number(match[2]) : size - 1;
      if (start >= size || end < start) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      const chunk = data.subarray(start, end + 1);
      headers["Content-Length"] = String(chunk.length);
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      return new Response(chunk, { status: 206, headers });
    }

    return new Response(data, { status: 200, headers });
  } catch (error) {
    console.error("Chat attachment read failed:", error.message);
    return NextResponse.json({ error: "تعذر تحميل الملف." }, { status: 500 });
  }
}
