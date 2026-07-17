import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Film, Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { GradientCard } from "@/components/gradient-card";
import { StatCard } from "@/components/stat-card";
import { getAnalytics } from "@/lib/analytics.functions";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — ClipForge AI" }] }),
  component: Analytics,
});

function Analytics() {
  const fn = useServerFn(getAnalytics);
  const q = useQuery({ queryKey: ["analytics"], queryFn: () => fn() });

  if (q.isLoading || !q.data) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { totals, byDay } = q.data;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Analytics</p>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Your creator stats</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Clips created" value={totals.clips} icon={Film} />
        <StatCard label="Uploads" value={totals.uploads} icon={Upload} />
        <StatCard label="Successful" value={totals.successful} hint={`${totals.successRate}% rate`} icon={CheckCircle2} />
        <StatCard label="Failed" value={totals.failed} icon={XCircle} />
      </div>

      <GradientCard>
        <p className="text-sm font-semibold">Uploads · last 7 days</p>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDay}>
              <XAxis dataKey="day" stroke="oklch(0.68 0.03 260)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="oklch(0.68 0.03 260)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.21 0.035 265)",
                  border: "1px solid oklch(0.3 0.03 265 / 0.6)",
                  borderRadius: 12,
                  color: "oklch(0.97 0.01 260)",
                }}
              />
              <Bar dataKey="count" fill="oklch(0.68 0.22 295)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </GradientCard>

      <GradientCard>
        <p className="text-sm font-semibold">Pipeline</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Jobs completed</p>
            <p className="font-display text-2xl font-semibold">{totals.doneJobs}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Jobs total</p>
            <p className="font-display text-2xl font-semibold">{totals.jobs}</p>
          </div>
        </div>
      </GradientCard>
    </div>
  );
}
