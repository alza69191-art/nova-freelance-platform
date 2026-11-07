import { NextResponse } from "next/server";
import { getPool, query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_GALLERY_BYTES = 12 * 1024 * 1024;

function parseJson(value, fallback) {
  try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; }
  catch { return fallback; }
}
function normalizePackages(value, basePrice) {
  const supplied = Array.isArray(value) ? value : [];
  const input = supplied.length ? supplied : [{ name: "أساسي", description: "تنفيذ الخدمة الأساسية", price: basePrice, deliveryDays: 3, revisions: 1 }];
  if (input.length > 3) throw new Error("يمكن إضافة ثلاث باقات كحد أقصى.");
  return input.map((item, index) => {
    const name = String(item?.name || ["أساسي","قياسي","احترافي"][index]).trim().slice(0,60);
    const description = String(item?.description || "").trim().slice(0,500);
    const price = Number(item?.price);
    const deliveryDays = Number(item?.deliveryDays);
    const revisions = Number(item?.revisions ?? 0);
    if (!name || !Number.isFinite(price) || price < 0 || price > 100000000 ||
        !Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 365 ||
        !Number.isInteger(revisions) || revisions < 0 || revisions > 50) throw new Error("تحقق من اسم وسعر ومدة وتسليم كل باقة.");
    return { name, description, price, deliveryDays, revisions };
  });
}
function normalizeExtras(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 10) throw new Error("يمكن إضافة 10 خدمات إضافية كحد أقصى.");
  return value.map(item => {
    const name = String(item?.name || "").trim().slice(0,80);
    const description = String(item?.description || "").trim().slice(0,250);
    const price = Number(item?.price);
    const extraDays = Number(item?.extraDays ?? 0);
    if (!name || !Number.isFinite(price) || price <= 0 || price > 100000000 || !Number.isInteger(extraDays) || extraDays < 0 || extraDays > 365) throw new Error("تحقق من بيانات الخدمات الإضافية وأسعارها.");
    return { name, description, price, extraDays };
  });
}
async function inspectImage(file) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size || file.size > MAX_IMAGE_BYTES) throw new Error("كل صورة يجب أن تكون أقل من 3 ميغابايت.");
  const data = Buffer.from(await file.arrayBuffer());
  const ext = String(file.name || "").toLowerCase().split(".").pop();
  let mime = "";
  if (["jpg","jpeg"].includes(ext) && data[0]===0xff && data[1]===0xd8 && data[2]===0xff) mime="image/jpeg";
  else if (ext==="png" && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime="image/png";
  else if (ext==="gif" && ["GIF87a","GIF89a"].includes(data.subarray(0,6).toString("ascii"))) mime="image/gif";
  else if (ext==="webp" && data.subarray(0,4).toString("ascii")==="RIFF" && data.subarray(8,12).toString("ascii")==="WEBP") mime="image/webp";
  if (!mime) throw new Error("الصيغ المدعومة للصور: JPG وPNG وGIF وWEBP فقط.");
  const name = String(file.name || "image").replace(/[\\/\x00-\x1f\x7f]/g,"_").slice(0,120) || "image";
  return { data, mime, name };
}

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    const mine = new URL(request.url).searchParams.get("mine")==="1";
    if (mine && !user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const result = await query(
      `select s.id,s.seller_id,s.title,s.description,s.category,s.price,s.status,s.packages,s.extras,s.created_at,s.published_at,
              coalesce(nullif(p.display_name,''),'مستقل NOVA') as seller_name,
              (select m.id from service_media m where m.service_id=s.id order by m.sort_order,m.created_at limit 1) as cover_id,
              (select count(*)::int from service_media m where m.service_id=s.id) as image_count
       from services s left join profiles p on p.user_id=s.seller_id
       where ${mine ? "s.seller_id=$1" : "s.status='published'"}
       order by coalesce(s.published_at,s.created_at) desc limit 100`,
      mine ? [user.id] : []
    );
    return NextResponse.json({services:result.rows});
  } catch(error) {
    console.error("Services query failed:",error.message);
    return NextResponse.json({error:"تعذر تحميل الخدمات."},{status:503});
  }
}

export async function POST(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const form=await request.formData();
    const title=String(form.get("title")||"").trim();
    const description=String(form.get("description")||"").trim();
    const category=String(form.get("category")||"").trim();
    const price=Number(form.get("price"));
    if(title.length<5||title.length>120||description.length<20||description.length>10000||!category||category.length>80||!Number.isFinite(price)||price<0||price>100000000) return NextResponse.json({error:"تحقق من عنوان الخدمة ووصفها وتصنيفها وسعرها."},{status:400});
    let packages,extras,images;
    try {
      packages=normalizePackages(parseJson(form.get("packages"),[]),price);
      extras=normalizeExtras(parseJson(form.get("extras"),[]));
      const incoming=form.getAll("images").filter(file=>file&&typeof file.arrayBuffer==="function"&&file.size);
      if(incoming.length>5) throw new Error("يمكن إرفاق 5 صور كحد أقصى.");
      images=[]; let total=0;
      for(const file of incoming){const image=await inspectImage(file);total+=image.data.length;if(total>MAX_GALLERY_BYTES)throw new Error("مجموع أحجام الصور يتجاوز 12 ميغابايت.");images.push(image);}
    } catch(error){return NextResponse.json({error:error.message||"تحقق من الباقات والصور."},{status:400});}
    const client=await getPool().connect();
    let service;
    try {
      await client.query("begin");
      const inserted=await client.query(
        `insert into services(seller_id,title,description,category,price,status,packages,extras)
         values($1,$2,$3,$4,$5,'draft',$6::jsonb,$7::jsonb)
         returning id,title,description,category,price,status,packages,extras,created_at`,
        [user.id,title,description,category,price,JSON.stringify(packages),JSON.stringify(extras)]
      );
      service=inserted.rows[0];
      for(let i=0;i<images.length;i++){const image=images[i];await client.query(
        `insert into service_media(service_id,uploaded_by,file_name,mime_type,size_bytes,data,sort_order) values($1,$2,$3,$4,$5,$6,$7)`,
        [service.id,user.id,image.name,image.mime,image.data.length,image.data,i]
      );}
      await client.query("commit");
    } catch(error){await client.query("rollback");throw error;}
    finally{client.release();}
    return NextResponse.json({service},{status:201});
  } catch(error){
    console.error("Service creation failed:",error.message);
    return NextResponse.json({error:"تعذر إنشاء الخدمة."},{status:500});
  }
}

export async function PATCH(request) {
  try {
    const user=await getCurrentUser();
    if(!user) return NextResponse.json({error:"سجّل الدخول أولاً."},{status:401});
    const body=await request.json();
    const id=String(body.id||"");
    const status=String(body.status||"");
    if(!/^[0-9a-f-]{36}$/i.test(id)||!["draft","published","paused"].includes(status)) return NextResponse.json({error:"طلب تحديث الخدمة غير صالح."},{status:400});
    const result=await query(
      `update services s set status=$3,
        published_at=case when $3='published' then coalesce(published_at,now()) else published_at end,
        updated_at=now()
       where s.id=$1 and s.seller_id=$2
       returning s.id,s.status,s.published_at`,
      [id,user.id,status]
    );
    if(!result.rowCount) return NextResponse.json({error:"الخدمة غير موجودة أو لا تملك صلاحية تعديلها."},{status:404});
    return NextResponse.json({service:result.rows[0]});
  } catch(error){
    console.error("Service status update failed:",error.message);
    return NextResponse.json({error:"تعذر تحديث حالة الخدمة."},{status:500});
  }
}
