import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Globe, Lock, EyeOff, Upload as UploadIcon, Calendar, FileEdit, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { getClip } from "@/lib/clips.functions";
import { uploadToYouTube } from "@/lib/uploads.functions";

export const Route = createFileRoute("/_authenticated/upload/$clipId")({
  head: () => ({ meta: [{ title: "Upload — ClipForge AI" }] }),
  component: UploadPage,
});

type Visibility = "public" | "unlisted" | "private";
type Mode = "publish" | "draft" | "schedule";

function UploadPage() {
  const { clipId } = useParams({ from: "/_authenticated/upload/$clipId" });
  const navigate = useNavigate();
  const getClipFn = useServerFn(getClip);
  const uploadFn = useServerFn(uploadToYouTube);

  const clipQ = useQuery({ queryKey: ["clip", clipId], queryFn: () => getClipFn({ data: { clipId } }) });
  const clip = clipQ.data?.clip;

  const [visibility, setVisibility] = useState<Visibility>("public");
  const [mode, setMode] = useState<Mode>("publish");
  const [scheduledFor, setScheduledFor] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      uploadFn({
        data: {
          clipId,
          visibility,
          mode,
          scheduledFor: mode === "schedule" ? new Date(scheduledFor).toISOString() : null,
          title: clip?.title ?? "Untitled clip",
          description: clip?.description ?? "",
          tags: clip?.tags ?? [],
        },
      }),
    onSuccess: (r) => {
      toast.success(r.simulated ? "Upload simulated (no YouTube connection)" : "Uploaded to YouTube!");
      navigate({ to: "/history" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  if (clipQ.isLoading || !clip) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Upload</p>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Publish to YouTube</h1>
      </div>

      <GradientCard>
        <div className="flex items-center gap-3">
          {clip.thumbnail_url ? (
            <img src={clip.thumbnail_url} alt="" className="h-24 w-16 rounded-xl object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold">{clip.title ?? "Untitled"}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{clip.description}</p>
          </div>
        </div>
      </GradientCard>

      <GradientCard>
        <p className="text-sm font-semibold">Visibility</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { id: "public", label: "Public", icon: Globe },
            { id: "unlisted", label: "Unlisted", icon: EyeOff },
            { id: "private", label: "Private", icon: Lock },
          ].map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                onClick={() => setVisibility(v.id as Visibility)}
                className={`flex flex-col items-center gap-1 rounded-2xl border py-3 text-xs font-medium transition ${
                  visibility === v.id
                    ? "border-transparent bg-gradient-brand text-primary-foreground shadow-glow"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <Icon size={16} />
                {v.label}
              </button>
            );
          })}
        </div>
      </GradientCard>

      <GradientCard>
        <p className="text-sm font-semibold">When</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { id: "publish", label: "Now", icon: UploadIcon },
            { id: "draft", label: "Draft", icon: FileEdit },
            { id: "schedule", label: "Schedule", icon: Calendar },
          ].map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                onClick={() => setMode(v.id as Mode)}
                className={`flex flex-col items-center gap-1 rounded-2xl border py-3 text-xs font-medium transition ${
                  mode === v.id
                    ? "border-transparent bg-gradient-brand text-primary-foreground shadow-glow"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <Icon size={16} />
                {v.label}
              </button>
            );
          })}
        </div>
        {mode === "schedule" ? (
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="mt-3 w-full rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary"
          />
        ) : null}
      </GradientCard>

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || (mode === "schedule" && !scheduledFor)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-4 py-4 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
      >
        {mutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <UploadIcon size={18} />}
        {mode === "publish" ? "Upload now" : mode === "draft" ? "Save as draft" : "Schedule"}
      </button>
    </div>
  );
}
