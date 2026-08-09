import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegLib from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import type { Word } from "./whisper.js";

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || ffprobeInstaller.path || "ffprobe";
ffmpegLib.setFfmpegPath(FFMPEG_BIN);
ffmpegLib.setFfprobePath(FFPROBE_BIN);

export function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpegLib.ffprobe(file, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration ?? 0);
    });
  });
}

export function extractAudio(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpegLib(input)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .save(output)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

export async function renderClip(opts: {
  sourceVideo: string;
  outMp4: string;
  outJpg: string;
  startS: number;
  endS: number;
  words: Word[];
}): Promise<void> {
  const dir = path.dirname(opts.outMp4);
  fs.mkdirSync(dir, { recursive: true });

  const assPath = path.join(dir, `${path.basename(opts.outMp4, ".mp4")}.ass`);
  fs.writeFileSync(assPath, buildAss(opts.words, opts.startS, opts.endS), "utf8");
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const vf =
    `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':(iw-min(iw\\,ih*9/16))/2:(ih-min(ih\\,iw*16/9))/2,` +
    `scale=1080:1920:flags=lanczos,` +
    `ass='${escapedAss}'`;

  await runFfmpeg([
    "-y",
    "-ss", opts.startS.toFixed(3),
    "-to", opts.endS.toFixed(3),
    "-i", opts.sourceVideo,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    opts.outMp4,
  ]);

  const thumbAt = (opts.endS - opts.startS) * 0.15;
  await runFfmpeg([
    "-y",
    "-ss", thumbAt.toFixed(3),
    "-i", opts.outMp4,
    "-frames:v", "1",
    "-q:v", "3",
    opts.outJpg,
  ]);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (b) => { err += b.toString(); });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-700)}`));
    });
    p.on("error", reject);
  });
}

function fmtAssTime(t: number): string {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function buildAss(words: Word[], clipStart: number, clipEnd: number): string {
  const inClip = words
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({
      word: w.word.trim(),
      start: Math.max(0, w.start - clipStart),
      end: Math.min(clipEnd - clipStart, w.end - clipStart),
    }))
    .filter((w) => w.word.length > 0 && w.end > w.start);

  const groupSize = 4;
  const groups: Array<typeof inClip> = [];
  for (let i = 0; i < inClip.length; i += groupSize) groups.push(inClip.slice(i, i + groupSize));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,DejaVu Sans,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  for (const grp of groups) {
    if (grp.length === 0) continue;
    const gStart = grp[0].start;
    const gEnd = grp[grp.length - 1].end;
    for (let i = 0; i < grp.length; i++) {
      const active = grp[i];
      const parts = grp.map((w, j) =>
        j === i
          ? `{\\c&H00A855F7&\\b1}${escapeAss(w.word)}{\\c&HFFFFFF&\\b0}`
          : escapeAss(w.word),
      );
      events.push(
        `Dialogue: 0,${fmtAssTime(active.start)},${fmtAssTime(active.end)},Base,,0,0,0,,${parts.join(" ")}`,
      );
    }
    events.push(
      `Dialogue: 0,${fmtAssTime(gStart)},${fmtAssTime(gEnd)},Base,,0,0,0,,${grp.map((w) => escapeAss(w.word)).join(" ")}`,
    );
  }
  return header + events.join("\n") + "\n";
}

function escapeAss(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}
