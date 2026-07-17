import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listClips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clips")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { clips: data ?? [] };
  });

export const getClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clipId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: clip, error } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.clipId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { clip };
  });

const UpdateSchema = z.object({
  clipId: z.string().uuid(),
  patch: z
    .object({
      title: z.string().max(200).optional(),
      description: z.string().max(5000).optional(),
      hashtags: z.array(z.string().max(60)).max(30).optional(),
      tags: z.array(z.string().max(60)).max(30).optional(),
      subtitle_template: z.string().max(50).optional(),
      subtitle_style: z.record(z.string(), z.unknown()).optional(),
      thumbnail_text: z.string().max(80).optional(),
      thumbnail_url: z.string().url().max(2048).optional(),
    })
    .strict(),
});

export const updateClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clips")
      .update(data.patch)
      .eq("id", data.clipId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clipId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("clips").delete().eq("id", data.clipId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clipId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: clip } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.clipId)
      .maybeSingle();
    if (!clip) throw new Error("Clip not found");

    const { data: job } = await context.supabase
      .from("jobs")
      .select("source_title, source_url")
      .eq("id", clip.job_id)
      .maybeSingle();

    const { generateStructured } = await import("./ai-gateway.server");
    const system =
      "You write viral YouTube Shorts metadata. Respond with strict JSON: " +
      '{"title": string (max 80 chars), "description": string (2-3 sentences, hook + CTA), ' +
      '"hashtags": string[] (5-8, each starts with #), "tags": string[] (5-8 SEO keywords)}. ' +
      "Never use quotes inside strings that would break JSON.";
    const prompt =
      `Source video: "${job?.source_title ?? "Untitled"}"\n` +
      `Clip #${(clip.order_index ?? 0) + 1}, duration ${clip.duration_s ?? 30}s.\n` +
      "Write punchy, curiosity-driven Shorts metadata in English.";

    const out = await generateStructured<{
      title: string;
      description: string;
      hashtags: string[];
      tags: string[];
    }>(prompt, system);

    if (!out) return { ok: false as const };

    const patch = {
      title: (out.title ?? "").slice(0, 180),
      description: (out.description ?? "").slice(0, 4900),
      hashtags: (out.hashtags ?? []).slice(0, 15).map((h) => (h.startsWith("#") ? h : `#${h}`)),
      tags: (out.tags ?? []).slice(0, 15),
    };
    await context.supabase.from("clips").update(patch).eq("id", clip.id);
    return { ok: true as const, patch };
  });

export const generateThumbnailIdeas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clipId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: clip } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.clipId)
      .maybeSingle();
    if (!clip) throw new Error("Clip not found");

    const { generateStructured } = await import("./ai-gateway.server");
    const out = await generateStructured<{ ideas: string[] }>(
      `Write 3 short (max 5 words), high-contrast thumbnail hooks for a YouTube Short titled: "${clip.title ?? "clip"}". Reply as JSON: {"ideas": string[]}.`,
      "You produce thumbnail text ideas. JSON only.",
    );
    return { ideas: out?.ideas?.slice(0, 3) ?? [] };
  });
