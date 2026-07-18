import fs from "node:fs";
import OpenAI from "openai";

export type Word = { word: string; start: number; end: number };
export type Segment = { text: string; start: number; end: number };
export type Transcript = { text: string; words: Word[]; segments: Segment[] };

let client: OpenAI | null = null;
function openai() {
  if (!client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

export async function transcribe(audioPath: string): Promise<Transcript> {
  const res = await openai().audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });
  // The SDK returns a loose shape for verbose_json; normalize it.
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
