import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Youtube, Film, Upload, CheckCircle2, Plus, PlugZap } from "lucide-react";
import { GradientCard } from "@/components/gradient-card";
import { StatCard } from "@/components/stat-card";
import { GradientProgress } from "@/components/gradient-progress";
import { listJobs } from "@/lib/jobs.functions";
import { getAnalytics } from "@/lib/analytics.functions";
import { getYouTubeConnection } from "@/lib/youtube.functions";
import { listUploads } from "@/lib/uploads.functions";

const jobsQO = queryOptions({ queryKey: ["jobs"], queryFn: () => listJobs() });
const analyticsQO = queryOptions({ queryKey: ["analytics"], queryFn: () => getAnalytics() });
const ytQO = queryOptions({ queryKey: ["yt-connection"], queryFn: () => getYouTubeConnection() });
const uploadsQO = queryOptions({ queryKey: ["uploads"], queryFn: () => listUploads() });

export const Route = createFileRoute("/_authenticated/dashboard")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(jobsQO),
      context.queryClient.ensureQueryData(analyticsQO),
      context.queryClient.ensureQueryData(ytQO),
      context.queryClient.ensureQueryData(uploadsQO),
    ]),
  component: Dashboard,
});

function Dashboard() {
  const jobs = useSuspenseQuery({ ...jobsQO, queryFn: useServerFn(listJobs) });
  const analytics = useSuspenseQuery({ ...analyticsQO, queryFn: useServerFn(getAnalytics) });
  const yt = useSuspenseQuery({ ...ytQO, queryFn: useServerFn(getYouTubeConnection) });
  const uploads = useSuspenseQuery({ ...uploadsQO, queryFn: useServerFn(listUploads) });

  const active = jobs.data.jobs.filter((j) => j.status !== "done" && j.status !== "failed");
  const recentUploads = uploads.data.uploads.slice(0, 4);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Dashboard</p>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Welcome back 👋</h1>
        </div>
        <Link to="/create" className="inline-flex items-center gap-2 self-start rounded-full bg-gradient-brand px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">
          <Plus size={16} /> New clip
        </Link>
      </motion.div>

      <GradientCard glow>
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl bg-gradient-brand shadow-glow">
            <Youtube size={22} className="text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">YouTube channel</p>
            {yt.data.connection ? (
              <>
                <h2 className="font-display text-lg font-semibold">{yt.data.connection.channel_title}</h2>
                <p className={`text-xs ${yt.data.ready ? "text-success" : "text-warning"}`}>
                  {yt.data.ready ? "Connected · automatic Unlisted uploads enabled" : "Authorization expired · reconnect in Settings"}
                </p>
              </>
            ) : (
              <>
                <h2 className="font-display text-lg font-semibold">Not connected</h2>
                <p className="text-xs text-muted-foreground">Connect once in Settings to enable automatic YouTube uploads.</p>
              </>
            )}
          </div>
          <Link to="/settings" className="rounded-full border border-border px-3 py-1.5 text-xs">
            {yt.data.connection && yt.data.ready ? "Manage" : "Connect"}
          </Link>
        </div>
      </GradientCard>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Clips" value={analytics.data.totals.clips} icon={Film} />
        <StatCard label="Uploads" value={analytics.data.totals.uploads} icon={Upload} />
        <StatCard label="Success" value={`${analytics.data.totals.successRate}%`} icon={CheckCircle2} />
        <StatCard label="Jobs" value={analytics.data.totals.jobs} icon={PlugZap} />
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Active jobs</h2>
        {active.length === 0 ? (
          <GradientCard><p className="text-sm text-muted-foreground">No jobs running. Start a new clip generation to see progress here.</p></GradientCard>
        ) : (
          <div className="space-y-3">
            {active.map((job) => (
              <Link key={job.id} to="/clips/$jobId" params={{ jobId: job.id }} className="block">
                <GradientCard className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{job.source_title ?? "Untitled video"}</p>
                      <p className="mt-1 text-xs capitalize text-muted-foreground">{job.stage ?? job.status} · {job.clip_count} clips × {job.clip_duration}s</p>
                    </div>
                    <div className="text-right text-xs font-semibold text-brand-cyan">{job.progress}%</div>
                  </div>
                  <div className="mt-3"><GradientProgress value={job.progress} /></div>
                </GradientCard>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Recent uploads</h2>
          <Link to="/history" className="text-xs text-brand-cyan">View all</Link>
        </div>
        {recentUploads.length === 0 ? (
          <GradientCard><p className="text-sm text-muted-foreground">No uploads yet.</p></GradientCard>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {recentUploads.map((u) => (
              <GradientCard key={u.id} className="p-4">
                <div className="flex items-start gap-3">
                  {u.clips?.thumbnail_url ? (
                    <img src={u.clips.thumbnail_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="size-14 shrink-0 rounded-xl bg-secondary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.title ?? u.clips?.title ?? "Untitled"}</p>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">{u.status}</p>
                  </div>
                </div>
              </GradientCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
