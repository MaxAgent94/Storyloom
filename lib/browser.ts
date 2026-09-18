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
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const payload = serialized === undefined ? undefined : await new Response(
    new Blob([serialized]).stream().pipeThrough(new CompressionStream('gzip')),
  ).blob();
  const r = await fetch(`/api/${path}`, {
    method,
    headers: {
      "Content-Type": payload ? "application/octet-stream" : "application/json",
      "X-Storyloom-Transfer": "gzip",
      Authorization: `Bearer ${data.session?.access_token || ""}`,
    },
    ...(payload === undefined ? {} : { body: payload }),
  });
  const result = r.headers.get('x-storyloom-transfer') === 'gzip'
    ? await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).json()
    : await r.json();
  if (!r.ok) throw new Error(result.error || `Request failed (${r.status})`);
  return result;
}
