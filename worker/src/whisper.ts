import fs from "node:fs";
import OpenAI from "openai";

export type Word = { word: string; start: number; end: number };
export type Segment = { text: string; start: number; end: number };
export type Transcript = { text: string; words: Word[]; segments: Segment[] };

let client: OpenAI | null = null;
function openai() {
  if (!client) {
    const key = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY is not set");
    client = new OpenAI({
      apiKey: key,
      baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://clipforge.ai",
        "X-Title": process.env.OPENROUTER_TITLE ?? "ClipForge AI Worker",
      },
    });
  }
  return client;
}

export async function transcribe(audioPath: string): Promise<Transcript> {
  const model = process.env.OPENROUTER_WHISPER_MODEL ?? "openai/whisper-1";
  const res = await openai().audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });
  const raw = res as unknown as {
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
    segments?: Array<{ text: string; start: number; end: number }>;
  };
  return {
    text: raw.text ?? "",
    words: raw.words ?? [],
    segments: raw.segments ?? [],
  };
}
