import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GradientCard({
  children,
  className,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "card-elevated relative overflow-hidden p-5",
        glow && "shadow-glow",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-40 bg-gradient-brand-soft opacity-60 blur-3xl" />
      <div className="relative">{children}</div>
    </div>
  );
}
