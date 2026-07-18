import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import ytdl from "@distube/ytdl-core";

export async function downloadSource(sourceUrl: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (ytdl.validateURL(sourceUrl)) {
    const stream = ytdl(sourceUrl, {
      quality: "highest",
      filter: (f) => Boolean(f.hasAudio && f.hasVideo),
    });
    await pipeline(stream, fs.createWriteStream(dest));
    return;
  }

  // Generic HTTP(S) download.
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}`);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(dest));
}
