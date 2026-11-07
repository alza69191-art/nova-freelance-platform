import { cookies } from "next/headers";
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query } from "./db";

const scrypt = promisify(scryptCallback);
const COOKIE = "nova_session";
const SESSION_DAYS = 7;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be configured in Render.");
  return value;
}

function tokenHash(token) {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await query(
    "insert into sessions(user_id, token_hash, expires_at) values($1,$2,$3)",
    [userId, tokenHash(token), expires]
  );
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires,
  });
}

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const result = await query(
    `select u.id, u.email, u.role, p.display_name
     from sessions s join users u on u.id=s.user_id
     left join profiles p on p.user_id=u.id
     where s.token_hash=$1 and s.expires_at > now()
     limit 1`,
    [tokenHash(token)]
  );
  return result.rows[0] || null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await query("delete from sessions where token_hash=$1", [tokenHash(token)]);
  }
  jar.set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
