import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ count: totalJobs }, { count: doneJobs }, { count: totalClips }, uploadsRes] =
      await Promise.all([
        context.supabase.from("clipforge_jobs").select("id", { count: "exact", head: true }),
        context.supabase.from("clipforge_jobs").select("id", { count: "exact", head: true }).eq("status", "done"),
        context.supabase.from("clipforge_clips").select("id", { count: "exact", head: true }),
        context.supabase.from("clipforge_uploads").select("status, created_at"),
      ]);

    const uploads = uploadsRes.data ?? [];
    const uploaded = uploads.filter((u) => u.status === "uploaded" || u.status === "scheduled").length;
    const failed = uploads.filter((u) => u.status === "failed").length;
    const total = uploads.length;
    const successRate = total ? Math.round((uploaded / total) * 100) : 0;

    const now = new Date();
    const days: Array<{ day: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en", { weekday: "short" });
      const count = uploads.filter((u) => u.created_at.startsWith(key)).length;
      days.push({ day: label, count });
    }

    return {
      totals: {
        jobs: totalJobs ?? 0,
        doneJobs: doneJobs ?? 0,
        clips: totalClips ?? 0,
        uploads: total,
        successful: uploaded,
        failed,
        successRate,
      },
      byDay: days,
    };
  });

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("clipforge_user_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    return { settings: data ?? { theme: "dark", notifications_enabled: true } };
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      theme: z.enum(["dark", "light"]).optional(),
      notifications_enabled: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clipforge_user_settings")
      .upsert({ user_id: context.userId, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
