import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const result=await query(
      `select id,title,body,read_at,created_at from notifications
       where user_id=$1 order by created_at desc limit 30`,
      [user.id]
    );
    return NextResponse.json({
      notifications:result.rows,
      unread_count:result.rows.filter(item=>!item.read_at).length
    });
  } catch(error) {
    console.error("Notifications read failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل الإشعارات."},{status:503});
  }
}

export async function PATCH(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const id=String(body.id||"");
    if(body.all===true) {
      await query("update notifications set read_at=now() where user_id=$1 and read_at is null",[user.id]);
    } else if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      await query("update notifications set read_at=now() where id=$1 and user_id=$2",[id,user.id]);
    } else {
      return NextResponse.json({error:"الإشعار غير صالح."},{status:400});
    }
    return NextResponse.json({ok:true});
  } catch(error) {
    console.error("Notification update failed:",error.message);
    return NextResponse.json({error:"تعذر تحديث الإشعار."},{status:500});
  }
}
