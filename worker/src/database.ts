import fs from "node:fs";
import type { Readable } from "node:stream";
import { Pool, type PoolClient } from "pg";
import type { Job } from "./types.js";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const CHUNK_SIZE = 2 * 1024 * 1024;
const FALLBACK_ROOT = process.env.STATE_DIR || "./.clipforge-state";
const FALLBACK_JOBS = `${FALLBACK_ROOT}/jobs.json`;
const FALLBACK_MEDIA = `${FALLBACK_ROOT}/media`;
fs.mkdirSync(FALLBACK_MEDIA, { recursive: true });
function fallbackMediaPath(id: string) { return `${FALLBACK_MEDIA}/${encodeURIComponent(id)}.bin`; }
function fallbackMetaPath(id: string) { return `${FALLBACK_MEDIA}/${encodeURIComponent(id)}.json`; }
function pathDir(file: string) { const idx = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")); return idx > 0 ? file.slice(0, idx) : "."; }
function readFallbackJobs(): Job[] { try { return JSON.parse(fs.readFileSync(FALLBACK_JOBS, "utf8")) as Job[]; } catch { return []; } }
function writeFallbackJobs(rows: Job[]) { fs.mkdirSync(FALLBACK_ROOT, { recursive: true }); const tmp = `${FALLBACK_JOBS}.tmp`; fs.writeFileSync(tmp, JSON.stringify(rows)); fs.renameSync(tmp, FALLBACK_JOBS); }

export const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false }, max: 4 })
  : null;

export async function initDatabase() {
  if (!pool) {
    console.warn("[database] DATABASE_URL is not configured; using local fallback");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clipforge_jobs (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS clipforge_jobs_device_updated_idx ON clipforge_jobs(device_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS clipforge_media (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clipforge_media_chunks (
      media_id TEXT NOT NULL REFERENCES clipforge_media(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      data BYTEA NOT NULL,
      PRIMARY KEY (media_id, chunk_index)
    );
  `);
}

export async function saveJob(job: Job) {
  if (!pool) {
    const rows = readFallbackJobs();
    const index = rows.findIndex((row) => row.id === job.id);
    if (index >= 0) rows[index] = job; else rows.push(job);
    writeFallbackJobs(rows);
    return;
  }
  await pool.query(
    `INSERT INTO clipforge_jobs(id, device_id, payload, created_at, updated_at)
     VALUES ($1,$2,$3::jsonb,to_timestamp($4/1000.0),NOW())
     ON CONFLICT(id) DO UPDATE SET device_id=EXCLUDED.device_id, payload=EXCLUDED.payload, updated_at=NOW()`,
    [job.id, job.deviceId, JSON.stringify(job), job.createdAt],
  );
}

export async function loadJobs(): Promise<Job[]> {
  if (!pool) return readFallbackJobs();
  const result = await pool.query<{ payload: Job }>(`SELECT payload FROM clipforge_jobs ORDER BY updated_at DESC LIMIT 500`);
  return result.rows.map((row) => row.payload);
}

export async function listJobsForDevice(deviceId: string): Promise<Job[]> {
  if (!pool) return readFallbackJobs().filter((job) => job.deviceId === deviceId).sort((a,b) => b.updatedAt - a.updatedAt);
  const result = await pool.query<{ payload: Job }>(`SELECT payload FROM clipforge_jobs WHERE device_id=$1 ORDER BY updated_at DESC LIMIT 100`, [deviceId]);
  return result.rows.map((row) => row.payload);
}

export async function deleteJobRow(id: string) {
  if (!pool) { writeFallbackJobs(readFallbackJobs().filter((job) => job.id !== id)); return; }
  await pool.query(`DELETE FROM clipforge_jobs WHERE id=$1`, [id]);
}

async function resetMedia(client: PoolClient, id: string, filename: string, contentType: string) {
  await client.query(`DELETE FROM clipforge_media WHERE id=$1`, [id]);
  await client.query(`INSERT INTO clipforge_media(id, filename, content_type, byte_size, created_at, updated_at) VALUES($1,$2,$3,0,NOW(),NOW())`, [id, filename, contentType]);
}

export async function storeMediaBuffer(id: string, filename: string, contentType: string, buffer: Buffer) {
  if (!pool) {
    fs.writeFileSync(fallbackMediaPath(id), buffer);
    fs.writeFileSync(fallbackMetaPath(id), JSON.stringify({ id, filename, content_type: contentType, byte_size: String(buffer.length) }));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await resetMedia(client, id, filename, contentType);
    let index = 0;
    for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
      const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + CHUNK_SIZE));
      await client.query(`INSERT INTO clipforge_media_chunks(media_id, chunk_index, data) VALUES($1,$2,$3)`, [id, index++, chunk]);
    }
    await client.query(`UPDATE clipforge_media SET byte_size=$2, updated_at=NOW() WHERE id=$1`, [id, buffer.length]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function storeMediaStream(id: string, filename: string, contentType: string, readable: Readable | NodeJS.ReadableStream, maxBytes = 600 * 1024 * 1024) {
  if (!pool) {
    const destination = fallbackMediaPath(id);
    const output = fs.createWriteStream(destination);
    let size = 0;
    for await (const raw of readable as AsyncIterable<Buffer | Uint8Array | string>) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > maxBytes) { output.destroy(); try { fs.unlinkSync(destination); } catch {} throw new Error(`Upload exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit`); }
      if (!output.write(chunk)) await new Promise<void>((resolve) => output.once("drain", resolve));
    }
    await new Promise<void>((resolve) => output.end(resolve));
    fs.writeFileSync(fallbackMetaPath(id), JSON.stringify({ id, filename, content_type: contentType, byte_size: String(size) }));
    return { id, size };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await resetMedia(client, id, filename, contentType);
    let pending = Buffer.alloc(0), size = 0, index = 0;
    for await (const raw of readable as AsyncIterable<Buffer | Uint8Array | string>) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > maxBytes) throw new Error(`Upload exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= CHUNK_SIZE) {
        const part = pending.subarray(0, CHUNK_SIZE);
        pending = pending.subarray(CHUNK_SIZE);
        await client.query(`INSERT INTO clipforge_media_chunks(media_id, chunk_index, data) VALUES($1,$2,$3)`, [id, index++, part]);
      }
    }
    if (pending.length) await client.query(`INSERT INTO clipforge_media_chunks(media_id, chunk_index, data) VALUES($1,$2,$3)`, [id, index++, pending]);
    await client.query(`UPDATE clipforge_media SET byte_size=$2, updated_at=NOW() WHERE id=$1`, [id, size]);
    await client.query("COMMIT");
    return { id, size };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function storeMediaFile(id: string, filePath: string, contentType: string, filename = filePath.split(/[\\/]/).pop() || "file.bin") {
  await storeMediaStream(id, filename, contentType, fs.createReadStream(filePath), 1024 * 1024 * 1024);
}

export async function mediaExists(id: string) {
  if (!pool) return fs.existsSync(fallbackMediaPath(id));
  const result = await pool.query(`SELECT 1 FROM clipforge_media WHERE id=$1`, [id]);
  return Boolean(result.rowCount);
}

export async function materializeMedia(id: string, destination: string) {
  if (!pool) { fs.mkdirSync(pathDir(destination), { recursive: true }); fs.copyFileSync(fallbackMediaPath(id), destination); return; }
  fs.mkdirSync(pathDir(destination), { recursive: true });
  const output = fs.createWriteStream(destination);
  let cursor = 0;
  try {
    while (true) {
      const result = await pool.query<{ chunk_index: number; data: Buffer }>(`SELECT chunk_index, data FROM clipforge_media_chunks WHERE media_id=$1 AND chunk_index >= $2 ORDER BY chunk_index ASC LIMIT 16`, [id, cursor]);
      if (!result.rows.length) break;
      for (const row of result.rows) {
        if (!output.write(row.data)) await new Promise<void>((resolve) => output.once("drain", resolve));
        cursor = row.chunk_index + 1;
      }
    }
  } finally { await new Promise<void>((resolve) => output.end(resolve)); }
}

export async function getMediaMeta(id: string) {
  if (!pool) { try { return JSON.parse(fs.readFileSync(fallbackMetaPath(id), "utf8")) as { id: string; filename: string; content_type: string; byte_size: string }; } catch { return null; } }
  const result = await pool.query<{ id: string; filename: string; content_type: string; byte_size: string }>(`SELECT id, filename, content_type, byte_size FROM clipforge_media WHERE id=$1`, [id]);
  return result.rows[0] ?? null;
}

export async function writeMediaToResponse(id: string, res: { setHeader(name: string, value: string | number): void; write(chunk: Buffer): boolean; once(event: string, cb: () => void): void; end(): void }) {
  const meta = await getMediaMeta(id);
  if (!meta) return false;
  res.setHeader("Content-Type", meta.content_type);
  res.setHeader("Content-Length", meta.byte_size);
  res.setHeader("Content-Disposition", `inline; filename="${meta.filename.replace(/[\"\r\n]/g, "-")}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (!pool) {
    if (!fs.existsSync(fallbackMediaPath(id))) return false;
    for await (const chunk of fs.createReadStream(fallbackMediaPath(id))) if (!res.write(chunk as Buffer)) await new Promise<void>((resolve) => res.once("drain", resolve));
    res.end(); return true;
  }
  let cursor = 0;
  while (true) {
    const result = await pool.query<{ chunk_index: number; data: Buffer }>(`SELECT chunk_index, data FROM clipforge_media_chunks WHERE media_id=$1 AND chunk_index >= $2 ORDER BY chunk_index ASC LIMIT 16`, [id, cursor]);
    if (!result.rows.length) break;
    for (const row of result.rows) {
      if (!res.write(row.data)) await new Promise<void>((resolve) => res.once("drain", resolve));
      cursor = row.chunk_index + 1;
    }
  }
  res.end(); return true;
}

export async function deleteMedia(id: string) {
  if (!pool) { try { fs.unlinkSync(fallbackMediaPath(id)); } catch {} try { fs.unlinkSync(fallbackMetaPath(id)); } catch {} return; }
  await pool.query(`DELETE FROM clipforge_media WHERE id=$1`, [id]);
}

export async function cleanupOldMedia(days = 7) {
  if (!pool) return;
  await pool.query(`DELETE FROM clipforge_media WHERE updated_at < NOW() - ($1::text || ' days')::interval`, [String(days)]);
  await pool.query(`DELETE FROM clipforge_jobs WHERE updated_at < NOW() - '30 days'::interval`);
}
