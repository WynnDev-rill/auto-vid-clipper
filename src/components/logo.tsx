import { Sparkles } from "lucide-react";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="grid shrink-0 place-items-center rounded-xl bg-gradient-brand shadow-glow"
        style={{ width: size + 8, height: size + 8 }}
      >
        <Sparkles
          aria-hidden="true"
          size={size - 6}
          className="text-primary-foreground"
          strokeWidth={2.5}
        />
      </div>
      <span className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap">
        <span className="font-display text-lg font-semibold tracking-tight">
          <span className="text-gradient-brand">Clip</span>
          <span className="text-foreground">Forge</span>
        </span>
        <span className="font-sans text-[9px] font-medium leading-none tracking-wide text-muted-foreground/80 sm:text-[10px]">
          By Wynn
        </span>
      </span>
    </div>
  );
}
