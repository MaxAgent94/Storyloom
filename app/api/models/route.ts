import { session, failure } from "@/lib/server";
export async function GET(req: Request) {
  try {
    await session(req);
    const r = await fetch("https://openrouter.ai/api/v1/models", {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw new Error(
        "Could not load OpenRouter models. You can enter a model ID manually.",
      );
    const { data } = await r.json();
    return Response.json(
      data.map(
        (m: {
          id: string;
          name: string;
          context_length: number;
          pricing: unknown;
        }) => ({
          id: m.id,
          name: m.name,
          context_length: m.context_length,
          pricing: m.pricing,
        }),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
