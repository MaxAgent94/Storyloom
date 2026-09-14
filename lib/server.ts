import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type SupabaseFailure = {
  code?: string;
  message?: string;
  status?: number;
};

export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey)
    throw new RequestError(
      "StoryLoom cannot verify access because its Supabase configuration is incomplete.",
      503,
      "SUPABASE_CONFIGURATION_ERROR",
    );
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co"))
      throw new Error("unexpected Supabase URL");
    return { url: parsed.origin, publishableKey, host: parsed.hostname };
  } catch {
    throw new RequestError(
      "StoryLoom cannot verify access because its Supabase URL is invalid.",
      503,
      "SUPABASE_CONFIGURATION_ERROR",
    );
  }
}

function diagnostic(error: SupabaseFailure) {
  return [error.code, error.message].filter(Boolean).join(": ") || "unknown error";
}

export function accessResult(
  allowed: { user_id: string } | null,
  error: SupabaseFailure | null,
  host: string,
) {
  if (error) {
    console.error("StoryLoom Supabase allowlist lookup failed", {
      host,
      code: error.code || "unknown",
      status: error.status || "unknown",
      message: error.message || "unknown error",
    });
    throw new RequestError(
      `StoryLoom could not verify private workspace access. Supabase ${diagnostic(error)}.`,
      503,
      "ACCESS_CHECK_FAILED",
    );
  }
  if (!allowed)
    throw new RequestError(
      "This private writing workspace is not enabled for this account.",
      403,
      "ACCESS_DENIED",
    );
}

export async function session(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token)
    throw new RequestError("Sign in to continue.", 401, "SIGN_IN_REQUIRED");
  const config = supabaseConfig();
  const db = createClient(
    config.url,
    config.publishableKey,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new RequestError(
      "Your session expired. Sign in again.",
      401,
      "SESSION_EXPIRED",
    );
  const { data: allowed, error: accessError } = await db
    .from("allowed_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  accessResult(allowed, accessError, config.host);
  return { db, user: data.user };
}
export function failure(e: unknown) {
  if (!(e instanceof RequestError))
    console.error("StoryLoom request failed", e);
  return Response.json(
    {
      error: e instanceof Error ? e.message : "Request failed.",
      code: e instanceof RequestError ? e.code : "REQUEST_FAILED",
    },
    { status: e instanceof RequestError ? e.status : 400 },
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
