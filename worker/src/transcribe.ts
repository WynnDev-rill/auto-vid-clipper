import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import type { Segment, Transcript, Word } from "./types.js";

const TOOL_ROOT = path.resolve(process.env.WHISPER_CPP_DIR || "./.tools/whispercpp");
const ARCHIVE = path.join(TOOL_ROOT, "whisper-bin.tar.gz");
const MODEL = path.join(TOOL_ROOT, "ggml-tiny-q5_1.bin");
const BINARY_URL = process.env.WHISPER_CPP_BINARY_URL || "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-ubuntu-x64.tar.gz";
const MODEL_URL = process.env.WHISPER_CPP_MODEL_URL || "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin";
let toolsPromise: Promise<{ binary: string; model: string }> | null = null;

async function download(url: string, destination: string, minBytes: number) {
  if (fs.existsSync(destination) && fs.statSync(destination).size >= minBytes) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.download`;
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "ClipForge/3" } });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${path.basename(destination)}`);
  await streamPipeline(response.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(temp));
  if (fs.statSync(temp).size < minBytes) { fs.unlinkSync(temp); throw new Error(`Downloaded ${path.basename(destination)} is incomplete`); }
  fs.renameSync(temp, destination);
}

function run(command: string, args: string[], timeoutMs = 120_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(command)} exited ${code}: ${(stderr || stdout).slice(-1200)}`)); });
  });
}

function findFile(root: string, names: string[]): string | null {
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { const nested = findFile(full, names); if (nested) return nested; }
    else if (names.includes(entry.name)) return full;
  }
  return null;
}

async function ensureTools() {
  if (!toolsPromise) toolsPromise = (async () => {
    fs.mkdirSync(TOOL_ROOT, { recursive: true });
    let binary = findFile(TOOL_ROOT, ["whisper-cli", "main"]);
    if (!binary) {
      await download(BINARY_URL, ARCHIVE, 1_000_000);
      await run("tar", ["-xzf", ARCHIVE, "-C", TOOL_ROOT], 60_000);
      binary = findFile(TOOL_ROOT, ["whisper-cli", "main"]);
      if (!binary) throw new Error("whisper.cpp binary was not found after extraction");
      fs.chmodSync(binary, 0o755);
    }
    await download(MODEL_URL, MODEL, 10_000_000);
    return { binary, model: MODEL };
  })().catch((error) => { toolsPromise = null; throw error; });
  return toolsPromise;
}

function seconds(raw: string) {
  const match = raw.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`);
}

function parseTimestampedLines(output: string) {
  const rows: Array<{ start: number; end: number; text: string }> = [];
  for (const raw of output.split(/\r?\n/)) {
    const match = raw.match(/^\s*\[([^\]]+?)\s*-->\s*([^\]]+?)\]\s*(.+?)\s*$/);
    if (!match) continue;
    const text = match[3].trim();
    if (!text || /^\[.*\]$/.test(text)) continue;
    const start = seconds(match[1]), end = seconds(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) rows.push({ start, end, text });
  }
  return rows;
}

function rowsToWords(rows: Array<{ start: number; end: number; text: string }>) {
  const words: Word[] = [];
  for (const row of rows) {
    const pieces = row.text.split(/\s+/).filter(Boolean);
    if (!pieces.length) continue;
    const step = (row.end - row.start) / pieces.length;
    for (let index = 0; index < pieces.length; index++) words.push({ word: pieces[index], start: row.start + index * step, end: row.start + (index + 1) * step });
  }
  return words;
}

function segmentWords(words: Word[]): Segment[] {
  const segments: Segment[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    segments.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((word) => word.word).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim() });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    const duration = current[current.length - 1].end - current[0].start;
    if (/[.!?…]$/.test(word.word) || duration >= 9 || current.length >= 28) flush();
  }
  flush();
  return segments;
}

export async function transcribe(audioPath: string): Promise<Transcript> {
  const { binary, model } = await ensureTools();
  const threads = Math.max(2, Math.min(6, Number(process.env.WHISPER_THREADS || 4)));
  const { stdout, stderr } = await run(binary, ["-m", model, "-f", audioPath, "-l", "auto", "-t", String(threads), "-sow", "-ml", "1", "-np", "-ng"], 45 * 60 * 1000);
  const rows = parseTimestampedLines(`${stdout}\n${stderr}`);
  const words = rowsToWords(rows);
  if (!words.length) throw new Error("No speech could be recognized in this video");
  const segments = segmentWords(words);
  return { text: words.map((word) => word.word).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim(), words, segments };
}
