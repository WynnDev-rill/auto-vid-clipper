import type { Segment } from "./whisper.js";

export type Highlight = {
  start_s: number;
  end_s: number;
  reason: string;
  score: number;
  signals: string[];
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function words(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

function heuristicSignals(text: string) {
  const lower = text.toLowerCase();
  const signals: string[] = [];
  if (/\b(why|how|secret|mistake|never|always|truth|problem|biggest|best|worst|important)\b/.test(lower)) signals.push("strong-hook");
  if (/\b(love|hate|angry|afraid|fear|shocked|crazy|amazing|pain|happy|sad|laugh|funny|wow)\b/.test(lower)) signals.push("emotion");
  if (/\b(but|however|until|then|because|therefore|actually|instead)\b/.test(lower)) signals.push("story-turn");
  if (/[!?]/.test(text)) signals.push("high-energy");
  if (/\b\d+(?:\.\d+)?%?\b/.test(text)) signals.push("specificity");
  return signals;
}

function candidateWindows(segments: Segment[], target: number): Highlight[] {
  if (!segments.length) return [];
  const candidates: Highlight[] = [];
  const desiredMin = Math.max(8, target * 0.55);
  const desiredMax = target * 1.35;

  for (let i = 0; i < segments.length; i++) {
    let text = "";
    let end = segments[i].end;
    for (let j = i; j < segments.length; j++) {
      end = segments[j].end;
      const duration = end - segments[i].start;
      if (duration > desiredMax) break;
      text += `${text ? " " : ""}${segments[j].text.trim()}`;
      if (duration < desiredMin) continue;

      const tokenCount = words(text).length;
      if (tokenCount < 12) continue;
      const signals = heuristicSignals(text);
      const density = Math.min(18, Math.round((tokenCount / Math.max(1, duration)) * 6));
      const completeness = /[.!?]["')\]]?$/.test(text.trim()) ? 10 : 4;
      const hook = signals.includes("strong-hook") ? 18 : 5;
      const emotion = signals.includes("emotion") ? 14 : 3;
      const turn = signals.includes("story-turn") ? 12 : 2;
      const energy = signals.includes("high-energy") ? 10 : 2;
      const specificity = signals.includes("specificity") ? 8 : 1;
      const lengthFit = Math.max(0, 12 - Math.round(Math.abs(duration - target) / Math.max(4, target) * 12));
      const score = Math.max(25, Math.min(92, 20 + density + completeness + hook + emotion + turn + energy + specificity + lengthFit));

      candidates.push({
        start_s: Math.max(0, segments[i].start - 0.15),
        end_s: end + 0.2,
        reason: signals.length ? `Strong ${signals.slice(0, 3).join(", ").replaceAll("-", " ")}` : "Complete, information-dense moment",
        score,
        signals: signals.length ? signals : ["context-complete"],
      });
    }
  }
  return candidates;
}

function overlaps(a: Highlight, b: Highlight) {
  const overlap = Math.max(0, Math.min(a.end_s, b.end_s) - Math.max(a.start_s, b.start_s));
  return overlap > Math.min(a.end_s - a.start_s, b.end_s - b.start_s) * 0.35;
}

function rankedHeuristicHighlights(opts: {
  segments: Segment[];
  totalDuration: number;
  clipDuration: number;
  count: number;
}): Highlight[] {
  const candidates = candidateWindows(opts.segments, opts.clipDuration)
    .map((h) => ({ ...h, end_s: Math.min(opts.totalDuration, h.end_s) }))
    .sort((a, b) => b.score - a.score);
  const picked: Highlight[] = [];
  for (const candidate of candidates) {
    if (picked.some((item) => overlaps(item, candidate))) continue;
    picked.push(candidate);
    if (picked.length >= opts.count) break;
  }
  return picked.sort((a, b) => b.score - a.score);
}

export async function scoreHighlights(opts: {
  segments: Segment[];
  totalDuration: number;
  clipDuration: number;
  count: number;
  goal?: string;
}): Promise<Highlight[]> {
  const heuristic = rankedHeuristicHighlights(opts);
  const key = process.env.LOVABLE_API_KEY;
  if (!key || opts.segments.length === 0) return heuristic;

  const compact = opts.segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.trim()}`)
    .join("\n")
    .slice(0, 120_000);
  const model = process.env.LOVABLE_MODEL || "google/gemini-3-flash-preview";
  const system =
    "You are a short-form video moment ranker. Find self-contained moments worth reviewing, not random intervals. " +
    "Judge hook strength, context completeness, emotion/surprise, information value, pacing, and ending quality. " +
    "Reply as strict JSON only: " +
    '{"highlights":[{"start_s":number,"end_s":number,"score":number,"reason":string,"signals":[string]}]}. ' +
    "Score is 0-100 and must be discriminative. Do not overlap highlights. Never invent timestamps outside the transcript.";
  const goal = opts.goal ? `User preference: ${opts.goal}\n` : "";
  const user =
    `Source duration: ${opts.totalDuration.toFixed(1)}s. Target length: about ${opts.clipDuration}s; natural boundaries matter more than exact length. ` +
    `Return up to ${opts.count} strongest candidates ranked best first.\n${goal}\nTranscript:\n${compact}`;

  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Lovable AI ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { highlights?: Partial<Highlight>[] };
    const cleaned = (parsed.highlights ?? [])
      .map((h) => {
        const start = Math.max(0, Math.min(opts.totalDuration - 1, Number(h.start_s) || 0));
        let end = Math.max(start + 5, Math.min(opts.totalDuration, Number(h.end_s) || start + opts.clipDuration));
        if (end - start > opts.clipDuration * 1.6) end = start + opts.clipDuration * 1.6;
        return {
          start_s: start,
          end_s: Math.min(opts.totalDuration, end),
          score: Math.max(0, Math.min(100, Math.round(Number(h.score) || 50))),
          reason: String(h.reason || "Strong candidate moment").slice(0, 180),
          signals: Array.isArray(h.signals) ? h.signals.map(String).slice(0, 5) : [],
        } satisfies Highlight;
      })
      .sort((a, b) => b.score - a.score);

    const picked: Highlight[] = [];
    for (const candidate of cleaned) {
      if (picked.some((item) => overlaps(item, candidate))) continue;
      picked.push(candidate);
      if (picked.length >= opts.count) break;
    }
    return picked.length >= Math.min(3, opts.count) ? picked : heuristic;
  } catch (error) {
    console.error("[highlights] AI ranker failed; using transcript heuristic:", error);
    return heuristic;
  }
}
