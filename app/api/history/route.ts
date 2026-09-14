import { session, failure } from "@/lib/server";
export async function GET(req: Request) {
  try {
    const { db } = await session(req);
    const q = new URL(req.url).searchParams;
    const { data, error } = await db
      .from("section_versions")
      .select("*")
      .eq("project_id", q.get("project"))
      .eq("node_id", q.get("node"))
      .eq("section", q.get("section"))
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json(data);
  } catch (e) {
    return failure(e);
  }
}
