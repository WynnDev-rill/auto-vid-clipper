export type AspectRatio = "9:16" | "1:1" | "16:9";
export type CaptionStyle = "modern" | "bold" | "minimal";

export type ScoreBreakdown = {
  hook: number;
  context: number;
  emotion: number;
  value: number;
  pacing: number;
  visual: number;
  prompt: number;
};

export type ClipResult = {
  order: number;
  video_url: string;
  thumbnail_url: string;
  duration_s: number;
  transcript?: string;
  start_s: number;
  end_s: number;
  score: number;
  score_breakdown: ScoreBreakdown;
  reason: string;
  signals: string[];
};

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "rendering"
  | "cancel_requested"
  | "cancelled"
  | "done"
  | "failed";

export type Job = {
  id: string;
  deviceId: string;
  sourceUrl?: string;
  uploadId?: string;
  sourceTitle?: string;
  clipDuration: number;
  clipCount: number;
  goal?: string;
  status: JobStatus;
  progress: number;
  clips: ClipResult[];
  error?: string;
  createdAt: number;
  startedAt: number;
  updatedAt: number;
  stageStartedAt: number;
  sourceDurationS?: number;
  completedClips: number;
  estimatedRemainingS?: number;
  transcriptMediaId?: string;
};

export type Word = { word: string; start: number; end: number };
export type Segment = { text: string; start: number; end: number };
export type Transcript = { text: string; words: Word[]; segments: Segment[]; language?: string };
