import { session, failure, body } from "@/lib/server";
import { validateProject } from "@/lib/domain";
export async function GET(req: Request) {
  try {
    const { db } = await session(req);
    const { data, error } = await db
      .from("projects")
      .select("id,title,revision,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const { data: project, error: e } = await db
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();
      if (e) throw e;
      return Response.json(project);
    }
    return Response.json(data);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const { db } = await session(req);
    const b = await body(req);
    if (!validateProject(b.project))
      throw new Error("Invalid project structure.");
    const { data, error } = await db.rpc("save_project", {
      p_id: b.project.id,
      p_body: b.project,
      p_expected: b.revision ?? 0,
      p_meta: b.meta || { action: "manual" },
    });
    if (error)
      throw new Error(
        error.message.includes("conflict")
          ? "Save conflict: another tab has newer changes. Download your draft before reloading."
          : error.message,
      );
    return Response.json({ revision: data });
  } catch (e) {
    return failure(e);
  }
}
