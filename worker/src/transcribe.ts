import fs from "node:fs";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { WaveFile } from "wavefile";
import type { Segment, Transcript, Word } from "./types.js";

const MODEL = process.env.CLIPFORGE_ASR_MODEL || "onnx-community/whisper-tiny_timestamped";
env.cacheDir = path.resolve(process.env.ASR_CACHE_DIR || "./.models");
env.allowLocalModels = true;
env.allowRemoteModels = true;

let transcriberPromise: Promise<any> | null = null;

async function getTranscriber() {
  if (!transcriberPromise) {
    console.log(`[asr] loading local model ${MODEL}`);
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL, { dtype: "q8" } as any);
  }
  return transcriberPromise;
}

function loadMono16kWav(filePath: string) {
  const wav = new WaveFile(fs.readFileSync(filePath));
  wav.toBitDepth("32f");
  wav.toSampleRate(16000);
  const samples = wav.getSamples();
  if (Array.isArray(samples)) {
    if (samples.length === 1) return samples[0];
    const length = samples[0]?.length ?? 0;
    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let total = 0;
      for (const channel of samples) total += channel[i] ?? 0;
      mono[i] = total / Math.max(1, samples.length);
    }
    return mono;
  }
  return samples;
}

function segmentWords(words: Word[]): Segment[] {
  const segments: Segment[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    segments.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((word) => word.word).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim(),
    });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    const duration = current[current.length - 1].end - current[0].start;
    if (/[.!?…]$/.test(word.word.trim()) || duration >= 9 || current.length >= 28) flush();
  }
  flush();
  return segments;
}

export async function transcribe(audioPath: string): Promise<Transcript> {
  const audio = loadMono16kWav(audioPath);
  const transcriber = await getTranscriber();
  const output = await transcriber(audio, {
    chunk_length_s: 29,
    stride_length_s: 5,
    return_timestamps: "word",
    task: "transcribe",
  } as any);

  const rawChunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const words: Word[] = rawChunks
    .map((chunk: any) => {
      const timestamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, 0];
      const start = Number(timestamp[0] ?? 0);
      const endRaw = timestamp[1] == null ? start + 0.2 : Number(timestamp[1]);
      const word = String(chunk.text ?? "").trim();
      return { word, start: Math.max(0, start), end: Math.max(start + 0.02, endRaw) };
    })
    .filter((word: Word) => word.word.length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end));

  if (!words.length) {
    const text = String(output?.text ?? "").trim();
    if (!text) throw new Error("No speech could be recognized in this video");
    const approx = text.split(/\s+/).filter(Boolean);
    const duration = audio.length / 16000;
    const step = duration / Math.max(1, approx.length);
    for (let i = 0; i < approx.length; i++) words.push({ word: approx[i], start: i * step, end: Math.min(duration, (i + 1) * step) });
  }

  const segments = segmentWords(words);
  return {
    text: String(output?.text ?? words.map((word) => word.word).join(" ")).trim(),
    words,
    segments,
    language: typeof output?.language === "string" ? output.language : undefined,
  };
}
