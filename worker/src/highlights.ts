import type { Segment } from "./whisper.js";

export type Highlight = { start_s: number; end_s: number; reason: string };

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Ask Lovable AI (Gemini) to pick the top `count` viral moments from the
 * transcript. Returns highlights clamped to the target clip duration.
 */
export async function scoreHighlights(opts: {
  segments: Segment[];
  totalDuration: number;
  clipDuration: number;
  count: number;
}): Promise<Highlight[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not set");
  const model = process.env.LOVABLE_MODEL || "google/gemini-3-flash-preview";

  // Compact transcript so we stay well within context.
  const compact = opts.segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.trim()}`)
    .join("\n");

  const system =
    "You pick viral short-form video highlights. Reply as strict JSON: " +
    '{"highlights":[{"start_s":number,"end_s":number,"reason":string}]}. ' +
    "Each highlight MUST be a self-contained hook, story beat, or punchline. " +
    "Prefer moments with strong emotion, tension, insight, or humor. " +
    "Do not overlap highlights. Never invent timestamps outside the transcript.";

  const user =
    `Source duration: ${opts.totalDuration.toFixed(1)}s. ` +
    `Target clip length: ${opts.clipDuration}s (\u00b125% ok). ` +
    `Return exactly ${opts.count} highlights.\n\nTranscript:\n${compact}`;

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Lovable AI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { highlights?: Highlight[] };

  const raw = parsed.highlights ?? [];
  const clamped = raw
    .map((h) => {
      const start = Math.max(0, Math.min(opts.totalDuration - 1, Number(h.start_s) || 0));
      let end = Math.max(start + 2, Math.min(opts.totalDuration, Number(h.end_s) || start + opts.clipDuration));
      // Cap length near the requested clip duration.
      const maxLen = opts.clipDuration * 1.25;
      if (end - start > maxLen) end = start + maxLen;
      return { start_s: start, end_s: end, reason: h.reason ?? "" };
    })
    .sort((a, b) => a.start_s - b.start_s)
    .slice(0, opts.count);

  return clamped;
}
