import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegLib from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import type { AspectRatio, CaptionStyle, Word } from "./types.js";

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || ffprobeInstaller.path || "ffprobe";
ffmpegLib.setFfmpegPath(FFMPEG_BIN);
ffmpegLib.setFfprobePath(FFPROBE_BIN);

export function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => ffmpegLib.ffprobe(file, (error, data) => error ? reject(error) : resolve(Number(data.format.duration ?? 0))));
}

export function extractAudio(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpegLib(input).noVideo().audioChannels(1).audioFrequency(16000).audioCodec("pcm_s16le").format("wav").save(output).on("end", () => resolve()).on("error", reject);
  });
}

function dimensions(aspectRatio: AspectRatio, preview: boolean) {
  if (aspectRatio === "1:1") return preview ? [720, 720] : [1080, 1080];
  if (aspectRatio === "16:9") return preview ? [960, 540] : [1920, 1080];
  return preview ? [540, 960] : [1080, 1920];
}

export async function renderClip(opts: {
  sourceVideo: string; outMp4: string; outJpg: string; startS: number; endS: number; words: Word[];
  aspectRatio?: AspectRatio; captionStyle?: CaptionStyle; captions?: boolean; normalizeAudio?: boolean; cropMode?: "safe" | "fill"; preview?: boolean;
}) {
  const dir = path.dirname(opts.outMp4);
  fs.mkdirSync(dir, { recursive: true });
  const aspectRatio = opts.aspectRatio ?? "9:16", captionStyle = opts.captionStyle ?? "modern", captions = opts.captions ?? true;
  const preview = opts.preview ?? false, cropMode = opts.cropMode ?? "safe";
  const [width, height] = dimensions(aspectRatio, preview);
  const duration = Math.max(1, opts.endS - opts.startS);

  let filter = cropMode === "fill"
    ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[base]`
    : `[0:v]split=2[bgsrc][fgsrc];[bgsrc]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=18:8[bg];[fgsrc]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`;

  if (captions) {
    const assPath = path.join(dir, `${path.basename(opts.outMp4, ".mp4")}.ass`);
    fs.writeFileSync(assPath, buildAss(opts.words, opts.startS, opts.endS, width, height, captionStyle), "utf8");
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    filter += `;[base]ass='${escapedAss}'[v]`;
  } else filter += `;[base]null[v]`;

  const args = ["-y", "-ss", opts.startS.toFixed(3), "-i", opts.sourceVideo, "-t", duration.toFixed(3), "-filter_complex", filter, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", preview ? "ultrafast" : "veryfast", "-crf", preview ? "27" : "20", "-c:a", "aac", "-b:a", preview ? "96k" : "160k"];
  if (opts.normalizeAudio ?? true) args.push("-af", "loudnorm=I=-16:LRA=11:TP=-1.5");
  args.push("-movflags", "+faststart", opts.outMp4);
  await runFfmpeg(args);
  await runFfmpeg(["-y", "-ss", Math.max(0.4, duration * 0.2).toFixed(3), "-i", opts.outMp4, "-frames:v", "1", "-q:v", "3", opts.outJpg]);
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const process = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    process.stderr.on("data", (buffer) => { stderr += buffer.toString(); });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`)));
  });
}

function fmtAssTime(time: number) {
  const safe = Math.max(0, time), hours = Math.floor(safe / 3600), minutes = Math.floor((safe % 3600) / 60), seconds = Math.floor(safe % 60), cs = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function styleLine(width: number, height: number, style: CaptionStyle) {
  const scale = width / 1080;
  if (style === "minimal") return `Style: Base,DejaVu Sans,${Math.round(52 * scale)},&H00FFFFFF,&H00FFFFFF,&H80000000,&H50000000,0,0,0,0,100,100,0,0,1,2,0,2,${Math.round(50 * scale)},${Math.round(50 * scale)},${Math.round(height * 0.1)},1`;
  if (style === "bold") return `Style: Base,DejaVu Sans,${Math.round(76 * scale)},&H00FFFFFF,&H0000D7FF,&H00000000,&H78000000,-1,0,0,0,105,105,0,0,1,7,3,2,${Math.round(60 * scale)},${Math.round(60 * scale)},${Math.round(height * 0.12)},1`;
  return `Style: Base,DejaVu Sans,${Math.round(66 * scale)},&H00FFFFFF,&H0000FFFF,&H00000000,&H70000000,-1,0,0,0,100,100,0,0,1,5,2,2,${Math.round(60 * scale)},${Math.round(60 * scale)},${Math.round(height * 0.13)},1`;
}

function buildAss(words: Word[], clipStart: number, clipEnd: number, width: number, height: number, style: CaptionStyle) {
  const inClip = words.filter((word) => word.end > clipStart && word.start < clipEnd).map((word) => ({ word: word.word.trim(), start: Math.max(0, word.start - clipStart), end: Math.min(clipEnd - clipStart, word.end - clipStart) })).filter((word) => word.word.length > 0 && word.end > word.start);
  const groups: Array<typeof inClip> = [];
  for (let index = 0; index < inClip.length; index += 5) groups.push(inClip.slice(index, index + 5));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styleLine(width, height, style)}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events: string[] = [];
  for (const group of groups) for (let activeIndex = 0; activeIndex < group.length; activeIndex++) {
    const active = group[activeIndex];
    const parts = group.map((word, index) => index === activeIndex ? `{\\c&H00D67CFF&\\b1}${escapeAss(word.word)}{\\c&HFFFFFF&\\b0}` : escapeAss(word.word));
    events.push(`Dialogue: 0,${fmtAssTime(active.start)},${fmtAssTime(active.end)},Base,,0,0,0,,${parts.join(" ")}`);
  }
  return header + events.join("\n") + "\n";
}
function escapeAss(value: string) { return value.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}"); }
