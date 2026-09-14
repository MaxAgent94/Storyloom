import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export async function session(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Sign in to continue.");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new Error("Your session expired. Sign in again.");
  const { data: allowed } = await db
    .from("allowed_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!allowed)
    throw new Error(
      "This private writing workspace is not enabled for this account.",
    );
  return { db, user: data.user };
}
export function failure(e: unknown) {
  return Response.json(
    { error: e instanceof Error ? e.message : "Request failed." },
    { status: 400 },
  );
}
export async function body(req: Request) {
  const text = await req.text();
  if (text.length > 3_500_000)
    throw new Error(
      "This request is too large. Export a backup and split the project into books.",
    );
  return JSON.parse(text);
}
function key() {
  const hex = process.env.KEY_ENCRYPTION_SECRET || "";
  if (!/^[a-f0-9]{64}$/i.test(hex))
    throw new Error("Server key storage is not configured.");
  return Buffer.from(hex, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
