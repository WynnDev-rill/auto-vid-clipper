import type { LucideIcon } from "lucide-react";
import { GradientCard } from "./gradient-card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <GradientCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
          {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
        </div>
        <div className="grid size-10 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
          <Icon size={18} />
        </div>
      </div>
    </GradientCard>
  );
}
