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
    </div>
  );
}
