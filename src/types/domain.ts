export type JobStatus = "queued" | "transcribing" | "analyzing" | "rendering" | "done" | "failed";

export type SubtitleTemplate = "modern" | "minimal" | "tiktok" | "shorts" | "hormozi";

export type SubtitleStyle = {
  fontSize: number;
  color: string;
  stroke: string;
  strokeWidth: number;
  position: "top" | "middle" | "bottom";
  highlightColor: string;
  emojis: boolean;
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 32,
  color: "#ffffff",
  stroke: "#000000",
  strokeWidth: 2,
  position: "bottom",
  highlightColor: "#c084fc",
  emojis: true,
};

export const SUBTITLE_TEMPLATES: Array<{
  id: SubtitleTemplate;
  name: string;
  description: string;
  style: SubtitleStyle;
}> = [
  {
    id: "modern",
    name: "Modern",
    description: "Clean, bold, centered",
    style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 34, position: "middle", highlightColor: "#a855f7" },
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Thin, no highlight",
    style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 28, strokeWidth: 1, highlightColor: "#ffffff", emojis: false },
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "Word-by-word, punchy",
    style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 36, highlightColor: "#22d3ee" },
  },
  {
    id: "shorts",
    name: "YT Shorts",
    description: "YouTube Shorts default",
    style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 32, highlightColor: "#facc15" },
  },
  {
    id: "hormozi",
    name: "Hormozi",
    description: "Highlighted keywords",
    style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 38, highlightColor: "#22c55e", strokeWidth: 3 },
  },
];

export const CLIP_DURATIONS = [15, 30, 45, 60] as const;
export type ClipDuration = (typeof CLIP_DURATIONS)[number];
