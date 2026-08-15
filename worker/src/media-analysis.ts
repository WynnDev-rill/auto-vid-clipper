import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

function runAndCapture(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg analysis exited ${code}: ${stderr.slice(-600)}`)));
  });
}

export type MediaSignals = {
  sceneCuts: number[];
  silenceRanges: Array<{ start: number; end: number }>;
};

export async function analyzeMediaSignals(input: string): Promise<MediaSignals> {
  const [sceneResult, silenceResult] = await Promise.allSettled([
    runAndCapture(["-hide_banner", "-i", input, "-vf", "select='gt(scene,0.33)',showinfo", "-an", "-f", "null", "-"]),
    runAndCapture(["-hide_banner", "-i", input, "-af", "silencedetect=noise=-36dB:d=0.45", "-vn", "-f", "null", "-"]),
  ]);

  const sceneCuts: number[] = [];
  if (sceneResult.status === "fulfilled") {
    for (const match of sceneResult.value.matchAll(/pts_time:([0-9.]+)/g)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) sceneCuts.push(value);
    }
  }

  const silenceRanges: Array<{ start: number; end: number }> = [];
  if (silenceResult.status === "fulfilled") {
    const events: Array<{ kind: "start" | "end"; time: number }> = [];
    for (const match of silenceResult.value.matchAll(/silence_(start|end):\s*([0-9.]+)/g)) {
      events.push({ kind: match[1] as "start" | "end", time: Number(match[2]) });
    }
    let start: number | null = null;
    for (const event of events) {
      if (event.kind === "start") start = event.time;
      else if (start !== null) {
        silenceRanges.push({ start, end: event.time });
        start = null;
      }
    }
  }

  return { sceneCuts, silenceRanges };
}
