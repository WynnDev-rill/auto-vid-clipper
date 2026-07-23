import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SOURCE_VIDEOS_BUCKET = "source-videos";
export const MAX_SOURCE_VIDEO_BYTES = 500 * 1024 * 1024;
export const SOURCE_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;

const PrepareUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_SOURCE_VIDEO_BYTES),
  contentType: z.enum(SOURCE_VIDEO_TYPES),
});

function extensionFor(contentType: (typeof SOURCE_VIDEO_TYPES)[number]) {
  return contentType === "video/quicktime" ? "mov" : "mp4";
}

/** Creates a short-lived, single-object upload URL so video bytes bypass the app server. */
export const prepareSourceUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PrepareUploadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const path = `${context.userId}/${crypto.randomUUID()}.${extensionFor(data.contentType)}`;
    const { data: signed, error } = await context.supabase.storage
      .from(SOURCE_VIDEOS_BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      throw new Error(`Could not prepare video upload: ${error.message}`);
    }

    return {
      path,
      token: signed.token,
      originalName: data.fileName,
    };
  });
