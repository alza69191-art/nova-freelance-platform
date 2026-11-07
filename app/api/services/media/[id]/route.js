import { NextResponse } from "next/server";
import { query } from "../../../../../lib/db";
import { getCurrentUser } from "../../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request,{params}) {
  try {
    const {id}=await params;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id||""))) {
      return NextResponse.json({error:"الصورة غير موجودة."},{status:404});
    }
    const user=await getCurrentUser();
    const result=await query(
      `select m.file_name,m.mime_type,m.data,m.size_bytes,s.status,s.seller_id
       from service_media m join services s on s.id=m.service_id where m.id=$1 limit 1`,
      [id]
    );
    const file=result.rows[0];
    if(!file) return NextResponse.json({error:"الصورة غير موجودة."},{status:404});
    if(file.status!=="published"&&(!user||user.id!==file.seller_id)) {
      return NextResponse.json({error:"ليس لديك صلاحية مشاهدة هذه الصورة."},{status:403});
    }
    const headers={
      "Content-Type":file.mime_type,
      "Content-Length":String(file.size_bytes),
      "Content-Disposition":"inline",
      "X-Content-Type-Options":"nosniff",
      "Cache-Control":file.status==="published"?"public, max-age=3600":"private, no-store",
    };
    return new Response(file.data,{status:200,headers});
  } catch(error) {
    console.error("Service image read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل الصورة."},{status:500});
  }
}
