import type { MediaSignals } from "./media-analysis.js";
import type { ScoreBreakdown, Segment } from "./types.js";

export type Highlight = {
  start_s: number;
  end_s: number;
  text: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  reason: string;
  signals: string[];
};

const HOOK = /\b(why|how|secret|mistake|never|truth|problem|biggest|best|worst|important|ternyata|kenapa|bagaimana|rahasia|kesalahan|jangan|fakta|masalah|terbaik|terburuk|penting|bayangkan|coba pikir)\b/i;
const EMOTION = /\b(love|hate|angry|afraid|fear|shocked|crazy|amazing|pain|happy|sad|laugh|funny|wow|cinta|benci|marah|takut|kaget|gila|hebat|sakit|senang|sedih|lucu|anjir|gokil)\b/i;
const TURN = /\b(but|however|until|then|because|therefore|actually|instead|tapi|namun|sampai|kemudian|karena|jadi|ternyata|justru|sebaliknya)\b/i;
const VALUE = /\b(step|tip|reason|example|result|lesson|cara|tips|alasan|contoh|hasil|pelajaran|solusi|strategi|metode)\b/i;

function tokens(text: string) { return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function jaccard(a: string, b: string) {
  const aa = new Set(tokens(a)), bb = new Set(tokens(b));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / (aa.size + bb.size - intersection);
}
function overlapRatio(start: number, end: number, rangeStart: number, rangeEnd: number) {
  const overlap = Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
  return overlap / Math.max(0.1, end - start);
}

function scoreCandidate(text: string, start: number, end: number, goal: string | undefined, media: MediaSignals) {
  const duration = Math.max(1, end - start);
  const wordCount = tokens(text).length;
  const density = wordCount / duration;
  const signals: string[] = [];

  const hook = clamp((HOOK.test(text) ? 14 : 5) + (/^[^.!?]{0,80}[?!]/.test(text) ? 4 : 0) + (wordCount >= 18 ? 2 : 0), 0, 20);
  if (hook >= 14) signals.push("strong-hook");
  const context = clamp((/[.!?…]["')\]]?$/.test(text.trim()) ? 10 : 5) + (duration >= 14 ? 3 : 1) + (TURN.test(text) ? 2 : 0), 0, 15);
  if (context >= 12) signals.push("self-contained");
  const emotion = clamp((EMOTION.test(text) ? 11 : 3) + ((text.match(/[!?]/g)?.length ?? 0) * 2), 0, 15);
  if (emotion >= 10) signals.push("emotion");
  const value = clamp((VALUE.test(text) ? 8 : 3) + (/\b\d+(?:[.,]\d+)?%?\b/.test(text) ? 4 : 0) + (TURN.test(text) ? 3 : 0), 0, 15);
  if (value >= 11) signals.push("high-value");
  const pacing = clamp(15 - Math.abs(density - 2.6) * 5, 2, 15);
  if (pacing >= 12) signals.push("good-pacing");

  const sceneCount = media.sceneCuts.filter((time) => time > start && time < end).length;
  const nearScene = media.sceneCuts.some((time) => Math.abs(time - start) < 1.2 || Math.abs(time - end) < 1.2);
  let visual = clamp(3 + Math.min(5, sceneCount * 2) + (nearScene ? 2 : 0), 0, 10);
  if (visual >= 7) signals.push("visual-change");
  const silenceShare = media.silenceRanges.reduce((sum, range) => sum + overlapRatio(start, end, range.start, range.end), 0);
  if (silenceShare > 0.18) { visual = Math.max(0, visual - 2); signals.push("pause-heavy"); }

  let prompt = 5;
  if (goal?.trim()) {
    const goalTokens = new Set(tokens(goal).filter((token) => token.length >= 3));
    const bodyTokens = new Set(tokens(text));
    let matches = 0;
    for (const token of goalTokens) if (bodyTokens.has(token)) matches++;
    prompt = clamp(goalTokens.size ? Math.round((matches / goalTokens.size) * 10) : 5, 0, 10);
    if (prompt >= 6) signals.push("prompt-match");
  }

  const breakdown: ScoreBreakdown = {
    hook: Math.round(hook), context: Math.round(context), emotion: Math.round(emotion), value: Math.round(value),
    pacing: Math.round(pacing), visual: Math.round(visual), prompt: Math.round(prompt),
  };
  const total = clamp(Math.round(Object.values(breakdown).reduce((sum, score) => sum + score, 0)), 0, 100);
  const reasonParts = [
    breakdown.hook >= 14 ? "strong opening" : null,
    breakdown.context >= 12 ? "complete context" : null,
    breakdown.emotion >= 10 ? "emotional energy" : null,
    breakdown.value >= 11 ? "clear value" : null,
    breakdown.visual >= 7 ? "visual change" : null,
    breakdown.prompt >= 6 && goal ? "matches your request" : null,
  ].filter(Boolean);
  return { total, breakdown, signals: signals.length ? signals : ["context-complete"], reason: reasonParts.slice(0, 3).join(", ") || "Dense, self-contained moment" };
}

export function scoreHighlights(opts: { segments: Segment[]; totalDuration: number; clipDuration: number; count: number; goal?: string; media: MediaSignals }) {
  const candidates: Highlight[] = [];
  const minDuration = Math.max(10, opts.clipDuration * 0.5);
  const maxDuration = Math.min(120, opts.clipDuration * 1.55);
  for (let i = 0; i < opts.segments.length; i++) {
    let text = "";
    for (let j = i; j < opts.segments.length; j++) {
      const start = opts.segments[i].start, end = opts.segments[j].end, duration = end - start;
      if (duration > maxDuration) break;
      text += `${text ? " " : ""}${opts.segments[j].text.trim()}`;
      if (duration < minDuration || tokens(text).length < 12) continue;
      const scored = scoreCandidate(text, start, end, opts.goal, opts.media);
      const lengthPenalty = Math.min(8, Math.abs(duration - opts.clipDuration) / Math.max(8, opts.clipDuration) * 8);
      candidates.push({
        start_s: Math.max(0, start - 0.18), end_s: Math.min(opts.totalDuration, end + 0.22), text,
        score: clamp(Math.round(scored.total - lengthPenalty), 0, 100), score_breakdown: scored.breakdown,
        reason: scored.reason, signals: scored.signals,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected: Highlight[] = [];
  for (const candidate of candidates) {
    const temporalOverlap = selected.some((item) => {
      const overlap = Math.max(0, Math.min(item.end_s, candidate.end_s) - Math.max(item.start_s, candidate.start_s));
      return overlap > Math.min(item.end_s - item.start_s, candidate.end_s - candidate.start_s) * 0.32;
    });
    if (temporalOverlap || selected.some((item) => jaccard(item.text, candidate.text) > 0.72)) continue;
    selected.push(candidate);
    if (selected.length >= opts.count) break;
  }
  return selected;
}
