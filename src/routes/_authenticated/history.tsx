import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, ExternalLink, RefreshCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { listUploads, deleteUpload, uploadToYouTube } from "@/lib/uploads.functions";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "History — ClipForge AI" }] }),
  component: History,
});

function History() {
  const listFn = useServerFn(listUploads);
  const delFn = useServerFn(deleteUpload);
  const reFn = useServerFn(uploadToYouTube);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["uploads"], queryFn: () => listFn() });

  const del = useMutation({
    mutationFn: (uploadId: string) => delFn({ data: { uploadId } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["uploads"] });
    },
  });

  const reup = useMutation({
    mutationFn: (u: { clipId: string; title: string; description: string; tags: string[] }) =>
      reFn({
        data: {
          clipId: u.clipId,
          visibility: "public",
          mode: "publish",
          title: u.title,
          description: u.description,
          tags: u.tags,
          scheduledFor: null,
        },
      }),
    onSuccess: () => {
      toast.success("Re-upload queued");
      qc.invalidateQueries({ queryKey: ["uploads"] });
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">History</p>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">All uploads</h1>
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : (q.data?.uploads.length ?? 0) === 0 ? (
        <GradientCard>
          <p className="text-sm text-muted-foreground">No uploads yet.</p>
        </GradientCard>
      ) : (
        <div className="space-y-3">
          {q.data!.uploads.map((u) => (
            <GradientCard key={u.id} className="p-4">
              <div className="flex items-start gap-3">
                {u.clips?.thumbnail_url ? (
                  <img
                    src={u.clips.thumbnail_url}
                    alt=""
                    className="h-24 w-16 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="h-24 w-16 shrink-0 rounded-xl bg-secondary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.title ?? u.clips?.title ?? "Untitled"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleString()}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 capitalize ${
                        u.status === "failed"
                          ? "bg-destructive/20 text-destructive"
                          : u.status === "uploaded"
                            ? "bg-success/20 text-success"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {u.status}
                    </span>
                    {u.simulated ? (
                      <span className="rounded-full bg-warning/20 px-2 py-0.5 text-warning">simulated</span>
                    ) : null}
                    <span className="text-muted-foreground">· {u.visibility}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {u.youtube_video_id && !u.simulated ? (
                      <a
                        href={`https://youtube.com/watch?v=${u.youtube_video_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs"
                      >
                        <ExternalLink size={12} /> View
                      </a>
                    ) : null}
                    <button
                      onClick={() =>
                        reup.mutate({
                          clipId: u.clip_id,
                          title: u.title ?? "Re-upload",
                          description: u.description ?? "",
                          tags: [],
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs"
                    >
                      <RefreshCcw size={12} /> Re-upload
                    </button>
                    <button
                      onClick={() => del.mutate(u.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </GradientCard>
          ))}
        </div>
      )}
    </div>
  );
}
