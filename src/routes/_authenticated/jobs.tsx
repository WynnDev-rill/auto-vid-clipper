import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, CheckCircle2, Clock3, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { GradientCard } from "@/components/gradient-card";
import { GradientProgress } from "@/components/gradient-progress";
import { listJobs } from "@/lib/jobs.functions";

export const Route = createFileRoute("/_authenticated/jobs")({
  head: () => ({ meta: [{ title: "Jobs — ClipForge AI" }] }),
  component: JobsPage,
});

const FILTERS = ["all", "active", "done", "failed"] as const;
type Filter = (typeof FILTERS)[number];

function JobsPage() {
  const listFn = useServerFn(listJobs);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["jobs"],
    queryFn: () => listFn(),
    refetchInterval: (q) =>
      q.state.data?.jobs.some((job) => !["done", "failed", "cancelled"].includes(job.status))
        ? 3000
        : false,
  });

  const jobs = (query.data?.jobs ?? []).filter((job) => {
    const matchesSearch = (job.source_title ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && !["done", "failed", "cancelled"].includes(job.status)) ||
      job.status === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Processing</p>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Jobs</h1>
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-2xl border border-input bg-input/30 px-3 py-2.5">
          <Search size={15} className="text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <div className="flex gap-1 overflow-x-auto rounded-full bg-secondary p-1">
          {FILTERS.map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded-full px-3 py-2 text-xs capitalize ${filter === item ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {query.isPending ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="animate-spin" />
        </div>
      ) : query.isError ? (
        <GradientCard>
          <p className="text-sm text-destructive">Could not load jobs.</p>
          <button onClick={() => query.refetch()} className="mt-3 text-xs text-brand-cyan">
            Try again
          </button>
        </GradientCard>
      ) : jobs.length === 0 ? (
        <GradientCard>
          <p className="text-sm text-muted-foreground">No matching jobs.</p>
        </GradientCard>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const Icon =
              job.status === "done" ? CheckCircle2 : job.status === "failed" ? AlertCircle : Clock3;
            return (
              <Link key={job.id} to="/clips/$jobId" params={{ jobId: job.id }} className="block">
                <GradientCard className="p-4">
                  <div className="flex items-start gap-3">
                    <Icon
                      size={18}
                      className={job.status === "failed" ? "text-destructive" : "text-brand-cyan"}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-3">
                        <p className="truncate text-sm font-semibold">
                          {job.source_title ?? "Untitled video"}
                        </p>
                        <span className="text-xs font-semibold">{job.progress}%</span>
                      </div>
                      <p className="mt-1 text-xs capitalize text-muted-foreground">
                        {job.stage ?? job.status} · {job.clip_count} clips × {job.clip_duration}s
                      </p>
                      {job.estimated_remaining_s ? (
                        <p className="mt-1 text-xs text-brand-cyan">
                          About {Math.max(1, Math.ceil(job.estimated_remaining_s / 60))} min
                          remaining
                        </p>
                      ) : null}
                      <div className="mt-3">
                        <GradientProgress value={job.progress} />
                      </div>
                    </div>
                  </div>
                </GradientCard>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
