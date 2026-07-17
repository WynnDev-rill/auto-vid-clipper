import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UploadSchema = z.object({
  clipId: z.string().uuid(),
  visibility: z.enum(["public", "unlisted", "private"]),
  scheduledFor: z.string().datetime().optional().nullable(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000).default(""),
  tags: z.array(z.string().max(60)).max(20).default([]),
  mode: z.enum(["publish", "draft", "schedule"]),
});

export const listUploads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("uploads")
      .select("*, clips(title, thumbnail_url, duration_s)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { uploads: data ?? [] };
  });

export const uploadToYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UploadSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: clip } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.clipId)
      .maybeSingle();
    if (!clip) throw new Error("Clip not found");

    const { data: yt } = await context.supabase
      .from("youtube_connections")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();

    // No YouTube connection OR no source video URL → simulate the upload.
    if (!yt || !clip.video_url) {
      const simulatedId = `sim_${crypto.randomUUID().slice(0, 11)}`;
      const { data: upload, error } = await context.supabase
        .from("uploads")
        .insert({
          clip_id: clip.id,
          user_id: context.userId,
          youtube_video_id: simulatedId,
          visibility: data.visibility,
          scheduled_for: data.scheduledFor ?? null,
          status: data.mode === "draft" ? "draft" : data.mode === "schedule" ? "scheduled" : "uploaded",
          title: data.title,
          description: data.description,
          simulated: true,
          uploaded_at: data.mode === "publish" ? new Date().toISOString() : null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      await context.supabase.from("clips").update({ status: "uploaded" }).eq("id", clip.id);
      return { ok: true as const, uploadId: upload.id, simulated: true, videoId: simulatedId };
    }

    // Real YouTube upload path
    const { ensureFreshAccessToken } = await import("./youtube.server");
    const { encryptToken } = await import("./crypto.server");
    const fresh = await ensureFreshAccessToken({
      access_token: yt.access_token,
      access_token_expires_at: yt.access_token_expires_at,
      refresh_token_ciphertext: yt.refresh_token_ciphertext,
    });
    if (fresh.refreshed) {
      await context.supabase
        .from("youtube_connections")
        .update({ access_token: fresh.accessToken, access_token_expires_at: fresh.expiresAt })
        .eq("user_id", context.userId);
    }

    // Fetch the clip video bytes
    const videoRes = await fetch(clip.video_url);
    if (!videoRes.ok) throw new Error("Failed to fetch clip video");
    const videoBuf = await videoRes.arrayBuffer();

    const metadata = {
      snippet: {
        title: data.title,
        description: data.description,
        tags: data.tags,
        categoryId: "22",
      },
      status: {
        privacyStatus: data.mode === "draft" ? "private" : data.visibility,
        publishAt: data.mode === "schedule" ? data.scheduledFor : undefined,
        selfDeclaredMadeForKids: false,
      },
    };

    const boundary = `----clipforge-${crypto.randomUUID()}`;
    const parts: Uint8Array[] = [];
    const enc = new TextEncoder();
    parts.push(enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`));
    parts.push(enc.encode(JSON.stringify(metadata)));
    parts.push(enc.encode(`\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`));
    parts.push(new Uint8Array(videoBuf));
    parts.push(enc.encode(`\r\n--${boundary}--\r\n`));

    const totalLen = parts.reduce((n, p) => n + p.byteLength, 0);
    const body = new Uint8Array(totalLen);
    let off = 0;
    for (const p of parts) {
      body.set(p, off);
      off += p.byteLength;
    }

    const res = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fresh.accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      const { data: failedUpload } = await context.supabase
        .from("uploads")
        .insert({
          clip_id: clip.id,
          user_id: context.userId,
          visibility: data.visibility,
          status: "failed",
          error_message: errText.slice(0, 500),
          title: data.title,
          description: data.description,
        })
        .select()
        .single();
      // touch encryptToken to keep import used (avoids TS unused-import lint)
      void encryptToken;
      throw new Error(`YouTube upload failed: ${errText.slice(0, 200)}`);
    }

    const uploaded = (await res.json()) as { id: string };
    const { data: upload, error } = await context.supabase
      .from("uploads")
      .insert({
        clip_id: clip.id,
        user_id: context.userId,
        youtube_video_id: uploaded.id,
        visibility: data.visibility,
        scheduled_for: data.scheduledFor ?? null,
        status: data.mode === "schedule" ? "scheduled" : "uploaded",
        title: data.title,
        description: data.description,
        simulated: false,
        uploaded_at: data.mode === "publish" ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("clips").update({ status: "uploaded" }).eq("id", clip.id);
    return { ok: true as const, uploadId: upload.id, simulated: false, videoId: uploaded.id };
  });

export const deleteUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ uploadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("uploads").delete().eq("id", data.uploadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
