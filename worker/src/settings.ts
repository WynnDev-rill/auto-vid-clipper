import fs from "node:fs";
import path from "node:path";

export type WhisperProvider = "auto" | "groq" | "openai" | "openrouter";

const VALID: WhisperProvider[] = ["auto", "groq", "openai", "openrouter"];

const WORK_DIR = path.resolve(process.env.WORK_DIR || "./.work");
const STATE_DIR = path.resolve(
  process.env.STATE_DIR || path.join(path.dirname(WORK_DIR), ".clipforge-state"),
);
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
fs.mkdirSync(STATE_DIR, { recursive: true });

type Persisted = {
  whisperProvider: WhisperProvider;
  lastUsedProvider?: "groq" | "openai" | "openrouter";
  lastUsedAt?: number;
};

function load(): Persisted {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<Persisted>;
    const provider = VALID.includes(raw.whisperProvider as WhisperProvider)
      ? (raw.whisperProvider as WhisperProvider)
      : "auto";
    return {
      whisperProvider: provider,
      lastUsedProvider: raw.lastUsedProvider,
      lastUsedAt: raw.lastUsedAt,
    };
  } catch {
    // Fall back to env override if the state file is missing.
    const envDefault = (process.env.WHISPER_PROVIDER as WhisperProvider) || "auto";
    return { whisperProvider: VALID.includes(envDefault) ? envDefault : "auto" };
  }
}

let state: Persisted = load();

function persist() {
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}

export function getWhisperProvider(): WhisperProvider {
  return state.whisperProvider;
}

export function setWhisperProvider(provider: WhisperProvider) {
  if (!VALID.includes(provider)) throw new Error(`Invalid provider: ${provider}`);
  state = { ...state, whisperProvider: provider };
  persist();
}

export function setLastUsedProvider(provider: "groq" | "openai" | "openrouter") {
  state = { ...state, lastUsedProvider: provider, lastUsedAt: Date.now() };
  persist();
}

export function getSettingsSnapshot() {
  return { ...state };
}
