import { Sparkles } from "lucide-react";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="grid place-items-center rounded-xl bg-gradient-brand shadow-glow"
        style={{ width: size + 8, height: size + 8 }}
      >
        <Sparkles size={size - 6} className="text-primary-foreground" strokeWidth={2.5} />
      </div>
      <span className="font-display text-lg font-semibold tracking-tight">
        <span className="text-gradient-brand">Clip</span>
        <span className="text-foreground">Forge</span>
      </span>
      <span className="ml-1 rounded-full border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
        by Wynn
      </span>
    </div>
  );
}
