import { createClient } from "@supabase/supabase-js";
export const configured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = configured
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    )
  : null;
export async function api(
  path: string,
  body?: unknown,
  method: "GET" | "POST" | "DELETE" = body === undefined ? "GET" : "POST",
) {
  const { data } = await supabase!.auth.getSession();
  const r = await fetch(`/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token || ""}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || `Request failed (${r.status})`);
  return result;
}
