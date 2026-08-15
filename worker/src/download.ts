import fs from "node:fs";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import youtubedl from "youtube-dl-exec";

const UA = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/136 Mobile Safari/537.36";

function validatePublicUrl(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) video URLs are supported");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) {
    throw new Error("Local network URLs are not allowed");
  }
  return url;
}

export async function downloadSource(sourceUrl: string, destination: string): Promise<void> {
  validatePublicUrl(sourceUrl);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try { fs.unlinkSync(destination); } catch {}

  try {
    await youtubedl(sourceUrl, {
      output: destination,
      format: "bv*[height<=1080]+ba/b[height<=1080]/b",
      mergeOutputFormat: "mp4",
      noPlaylist: true,
      noWarnings: true,
      retries: 3,
      fragmentRetries: 3,
      socketTimeout: 30,
      forceOverwrites: true,
      addHeader: [`User-Agent:${UA}`],
    }, { timeout: 12 * 60 * 1000 });
    if (fs.existsSync(destination) && fs.statSync(destination).size > 1024) return;
  } catch (error) {
    console.error("[download] yt-dlp failed; trying direct HTTP:", error);
    try { fs.unlinkSync(destination); } catch {}
  }

  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": UA, Accept: "video/*,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`Video download failed (${response.status})`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 2 * 1024 * 1024 * 1024) throw new Error("Video is larger than the 2 GB processing limit");
  await streamPipeline(response.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(destination));
  if (!fs.existsSync(destination) || fs.statSync(destination).size < 1024) throw new Error("Downloaded video is empty");
}
