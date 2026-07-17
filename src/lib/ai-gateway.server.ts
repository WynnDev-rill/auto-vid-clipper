// Server-only helper for calling Lovable AI Gateway using plain fetch.
// We use fetch directly (not the AI SDK provider) to keep this lightweight
// for structured JSON generation.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function callAiGateway(opts: {
  messages: ChatMessage[];
  model?: string;
  json?: boolean;
}): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_MODEL,
    messages: opts.messages,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new Error("AI rate limit reached. Please try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted. Please add credits to your workspace.");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function generateStructured<T>(prompt: string, system: string): Promise<T | null> {
  try {
    const content = await callAiGateway({
      json: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    return JSON.parse(content) as T;
  } catch (err) {
    console.error("[ai] structured generation failed:", err);
    return null;
  }
}
