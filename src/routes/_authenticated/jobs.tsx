import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Film, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { deleteJob, listJobs } from "@/lib/clipforge-client";

export const Route = createFileRoute("/_authenticated/jobs")({ head: () => ({ meta: [{ title: "Projects — ClipForge" }] }), component: Projects });
function Projects() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["clipforge-projects"], queryFn: listJobs, refetchOnWindowFocus: true });
  const remove = useMutation({ mutationFn: deleteJob, onSuccess: () => qc.invalidateQueries({ queryKey: ["clipforge-projects"] }), onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete project") });
  if (query.isPending) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  const jobs = query.data?.jobs ?? [];
  return <div className="mx-auto max-w-3xl space-y-5">
    <div className="flex items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Library</p><h1 className="font-display text-2xl font-semibold md:text-3xl">Projects</h1><p className="mt-1 text-sm text-muted-foreground">History is tied to this ClipForge installation. No account required.</p></div><Link to="/create" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-brand px-4 py-2 text-xs font-semibold text-primary-foreground"><Plus size={14} /> New</Link></div>
    {jobs.length === 0 ? <GradientCard className="py-12 text-center"><Film className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold">No projects yet</p><p className="mt-1 text-sm text-muted-foreground">Analyze your first video to see it here.</p></GradientCard> : <div className="space-y-3">{jobs.map((job) => <GradientCard key={job.id}><div className="flex items-start gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary"><Film size={18} /></div><div className="min-w-0 flex-1"><Link to="/clips/$jobId" params={{ jobId: job.id }} className="block truncate text-sm font-semibold hover:text-brand-cyan">{job.sourceTitle || `Project ${job.id.slice(0,6)}`}</Link><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="capitalize">{job.status.replaceAll("_"," ")}</span><span>{job.progress}%</span><span className="inline-flex items-center gap-1"><Clock3 size={11} /> {new Date(job.createdAt).toLocaleString()}</span></div>{job.status === "done" ? <p className="mt-2 text-xs text-muted-foreground">{job.clips.length} ranked moments</p> : null}{job.error ? <p className="mt-2 line-clamp-2 text-xs text-destructive">{job.error}</p> : null}</div><button onClick={() => remove.mutate(job.id)} disabled={remove.isPending} className="rounded-xl border border-border p-2 text-muted-foreground hover:text-destructive"><Trash2 size={15} /></button></div></GradientCard>)}</div>}
  </div>;
}
