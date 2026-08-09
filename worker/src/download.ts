import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import ytdl from "@distube/ytdl-core";

const REQUEST_OPTIONS = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  },
};

export async function downloadSource(sourceUrl: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.unlinkSync(dest); } catch {}

  if (ytdl.validateURL(sourceUrl)) {
    try {
      const info = await ytdl.getInfo(sourceUrl, { requestOptions: REQUEST_OPTIONS });
      const candidates = info.formats
        .filter((format) => Boolean(format.hasAudio && format.hasVideo && format.url))
        .sort((a, b) => {
          const ah = Number(a.height ?? 0);
          const bh = Number(b.height ?? 0);
          if (ah !== bh) return bh - ah;
          return Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0);
        });
      const format = candidates[0];
      if (!format) throw new Error("YouTube returned no downloadable audio+video format");
      const stream = ytdl.downloadFromInfo(info, {
        format,
        requestOptions: REQUEST_OPTIONS,
      });
      await pipeline(stream, fs.createWriteStream(dest));
      if (fs.statSync(dest).size < 1024) throw new Error("Downloaded YouTube file is unexpectedly small");
      return;
    } catch (firstError) {
      console.error("[download] selected YouTube format failed, retrying:", firstError);
      try { fs.unlinkSync(dest); } catch {}
      const stream = ytdl(sourceUrl, {
        quality: "highest",
        filter: "audioandvideo",
        requestOptions: REQUEST_OPTIONS,
      });
      await pipeline(stream, fs.createWriteStream(dest));
      if (fs.statSync(dest).size < 1024) throw new Error("YouTube retry produced an empty file");
      return;
    }
  }

  const res = await fetch(sourceUrl, {
    headers: { "User-Agent": REQUEST_OPTIONS.headers["User-Agent"] },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}`);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(dest));
  if (fs.statSync(dest).size < 1024) throw new Error("Downloaded source file is unexpectedly small");
}
