import { session, failure, body, decrypt } from "@/lib/server";
import { contextText, promptMessages, insertProse, manuscriptContextWords, type Project } from "@/lib/domain";
import { structureSources, structureInstruction } from '@/lib/structure';
export const maxDuration = 300;
export async function POST(req: Request) {
  try {
    const { db, user } = await session(req);
    const b = await body(req);
    if (
      typeof b.instruction !== "string" ||
      !b.instruction.trim() ||
      b.instruction.length > 50000 ||
      typeof b.model !== "string" ||
      !b.model ||
      !Array.isArray(b.sources)
    )
      throw new Error("Choose a model and enter guidance.");
    const { data: row, error } = await db
      .from("projects")
      .select("body,revision")
      .eq("id", b.projectId)
      .single();
    if (error) throw error;
    if (row.revision !== b.revision)
      throw new Error(
        "The project changed in another tab. Reload before generating.",
      );
    const p = row.body as Project,
      n = p.nodes.find((n) => n.id === b.nodeId);
    if (!n) throw new Error("Scene or book not found.");
    if (b.action === 'structure' && n.kind !== 'book') throw new Error('Select a Book to propose structure.');
    const context = contextText(
      p,
      n,
      b.action === 'structure' ? structureSources(p,n,b.sources) : b.sources,
      manuscriptContextWords(b.manuscriptWords),
    );
    const history = b.action !== 'structure' && b.includeChat ? p.messages.slice(-20) : [];
    if (b.action === 'structure') { b.instruction = structureInstruction; b.section = 'outline'; }
    const { data: cred, error: credentialError } = await db
      .from("provider_credentials")
      .select("ciphertext")
      .eq("user_id", user.id)
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (!cred)
      throw new Error(
        "Add your account OpenRouter API key in Settings. It will be shared by every project.",
      );
    const messages = promptMessages(context, history, b.instruction);
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${decrypt(cred.ciphertext)}`,
          "Content-Type": "application/json",
          "X-Title": "Storyloom",
        },
        body: JSON.stringify({
          model: b.model,
          messages,
          temperature: Math.max(0, Math.min(2, Number(b.temperature) || 0.7)),
          max_tokens: Math.max(
            256,
            Math.min(32768, Number(b.maxTokens) || 4096),
          ),
        }),
        signal: AbortSignal.timeout(270000),
      },
    );
    if (!response.ok) {
      const status = response.status;
      throw new Error(
        status === 402
          ? "OpenRouter credits are insufficient."
          : status === 401
            ? "OpenRouter rejected this key. Update it in Settings."
            : `OpenRouter request failed (${status}). Try another model or less context.`,
      );
    }
    const result = await response.json();
    const output = result.choices?.[0]?.message?.content;
    if (typeof output !== "string" || !output.trim())
      throw new Error("The model returned no text. Try another model.");
    let proposedOutput = output;
    if (b.action === 'prose') {
      const previous = n.sections.manuscript || '';
      const {start,end} = b.insertion || {};
      if (b.section !== 'manuscript' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > previous.length) throw new Error('Invalid manuscript selection.');
      proposedOutput = insertProse(previous,output,start,end);
    }
    const completed = {
      id: crypto.randomUUID(),
      output: proposedOutput,
      responseText: output,
      context,
      model: result.model || b.model,
      usage: result.usage,
      generationId: result.id,
      at: new Date().toISOString(),
      nodeId: b.nodeId,
      section: b.section,
      instruction: b.instruction,
      preset: b.preset,
      previous: n.sections[b.section] || "",
      action: b.action,
    };
    const { error: checkpointError } = await db
      .from("generations")
      .insert({
        id: completed.id,
        project_id: p.id,
        user_id: user.id,
        record: completed,
      });
    return Response.json({ ...completed, checkpointSaved: !checkpointError });
  } catch (e) {
    return failure(e);
  }
}

export async function GET(req: Request) {
  try {
    const { db } = await session(req);
    const id = new URL(req.url).searchParams.get("project");
    const { data, error } = await db
      .from("generations")
      .select("record")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json(data.map((r) => r.record));
  } catch (e) {
    return failure(e);
  }
}
