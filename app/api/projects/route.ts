import { session, failure, body, RequestError } from "@/lib/server";
import { validateProject } from "@/lib/domain";
import { hydrateProject, validateStoredDelta } from "@/lib/project-storage";
import { gzipSync } from 'node:zlib';
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
      const { history, history_order: _historyOrder, ...record } = project;
      const hydrated = { ...record, body: hydrateProject(project.body, history) };
      if (req.headers.get('x-storyloom-transfer') === 'gzip')
        return new Response(new Uint8Array(gzipSync(JSON.stringify(hydrated))), {
          headers: { 'Content-Type': 'application/octet-stream', 'X-Storyloom-Transfer': 'gzip', 'Cache-Control': 'no-store' },
        });
      return Response.json(hydrated);
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
    if (b.delta) {
      const { data: stored, error: readError } = await db.from('projects')
        .select('body,revision').eq('id', b.delta.id).single();
      if (readError) throw readError;
      if (stored.revision !== b.revision)
        throw new RequestError('The cloud revision changed. Your local draft has been retained.', 409, 'SAVE_CONFLICT');
      validateStoredDelta(stored.body, b.delta);
    }
    if (!b.delta && !validateProject(b.project))
      throw new Error("Invalid project structure.");
    const { data, error } = await db.rpc("save_project_v2", {
      p_id: b.delta?.id ?? b.project.id,
      p_body: b.delta ? null : b.project,
      p_delta: b.delta ?? null,
      p_expected: b.revision ?? 0,
      p_meta: b.meta || { action: "manual" },
    });
    if (error) {
      if (/conflict/i.test(error.message))
        throw new RequestError('The cloud revision changed. Your local draft has been retained.', 409, 'SAVE_CONFLICT');
      if (error.code === '57014')
        throw new RequestError('The database took too long to save. Your draft is still open; retry Save without reloading.', 503, 'SAVE_TIMEOUT');
      throw new Error(error.message);
    }
    return Response.json({ revision: data });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const { db } = await session(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new Error("Invalid project ID.");
    const { data, error } = await db.rpc("delete_project", { p_id: id });
    if (error) throw error;
    if (!data) throw new Error("Project not found or already deleted.");
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
