import { session, failure, body, encrypt } from "@/lib/server";
export async function GET(req: Request) {
  try {
    const { db, user } = await session(req);
    const { data, error } = await db
      .from("provider_credentials")
      .select("updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return Response.json({ hasKey: !!data, scope: "account" });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const { db, user } = await session(req);
    const { key } = await body(req);
    if (typeof key !== "string" || key.length < 20 || key.length > 512)
      throw new Error("Enter a valid OpenRouter API key.");
    const { error } = await db
      .from("provider_credentials")
      .upsert({
        user_id: user.id,
        ciphertext: encrypt(key),
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
