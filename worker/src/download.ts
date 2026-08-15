import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import ffmpegStatic from "ffmpeg-static";

const UA = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/136 Mobile Safari/537.36";
const YT_DLP_PATH = process.env.YT_DLP_PATH || path.resolve("./.tools/yt-dlp");
const YT_DLP_URL = process.env.YT_DLP_DOWNLOAD_URL || "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
let installPromise: Promise<string> | null = null;

function validatePublicUrl(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) video URLs are supported");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) throw new Error("Local network URLs are not allowed");
  return url;
}

async function ensureYtDlp() {
  if (fs.existsSync(YT_DLP_PATH) && fs.statSync(YT_DLP_PATH).size > 100_000) return YT_DLP_PATH;
  if (!installPromise) installPromise = (async () => {
    fs.mkdirSync(path.dirname(YT_DLP_PATH), { recursive: true });
    const temp = `${YT_DLP_PATH}.download`;
    const response = await fetch(YT_DLP_URL, { redirect: "follow", signal: AbortSignal.timeout(60_000), headers: { "User-Agent": UA } });
    if (!response.ok || !response.body) throw new Error(`Could not download yt-dlp (${response.status})`);
    await streamPipeline(response.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(temp));
    fs.chmodSync(temp, 0o755);
    fs.renameSync(temp, YT_DLP_PATH);
    return YT_DLP_PATH;
  })().catch((error) => { installPromise = null; try { fs.unlinkSync(`${YT_DLP_PATH}.download`); } catch {} throw error; });
  return installPromise;
}

function runYtDlp(binary: string, sourceUrl: string, destination: string) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      "--no-playlist", "--no-warnings", "--retries", "3", "--fragment-retries", "3", "--socket-timeout", "30",
      "--force-overwrites", "--merge-output-format", "mp4", "--format", "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--add-header", `User-Agent:${UA}`, "--output", destination,
    ];
    if (ffmpegStatic) args.push("--ffmpeg-location", ffmpegStatic);
    args.push(sourceUrl);
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 12 * 60 * 1000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-1200)}`)); });
  });
}

export async function downloadSource(sourceUrl: string, destination: string): Promise<void> {
  validatePublicUrl(sourceUrl);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try { fs.unlinkSync(destination); } catch {}

  try {
    const binary = await ensureYtDlp();
    await runYtDlp(binary, sourceUrl, destination);
    if (fs.existsSync(destination) && fs.statSync(destination).size > 1024) return;
  } catch (error) {
    console.error("[download] yt-dlp unavailable/failed; trying direct HTTP:", error);
    try { fs.unlinkSync(destination); } catch {}
  }

  const response = await fetch(sourceUrl, { headers: { "User-Agent": UA, Accept: "video/*,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Video download failed (${response.status})`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 2 * 1024 * 1024 * 1024) throw new Error("Video is larger than the 2 GB processing limit");
  await streamPipeline(response.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(destination));
  if (!fs.existsSync(destination) || fs.statSync(destination).size < 1024) throw new Error("Downloaded video is empty");
}
