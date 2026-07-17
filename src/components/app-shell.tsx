import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Wand2, History, BarChart3, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/create", label: "Create", icon: Wand2 },
  { to: "/history", label: "History", icon: History },
  { to: "/analytics", label: "Stats", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen">
      {/* Top bar (mobile + desktop) */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link to="/dashboard" className="focus:outline-none">
            <Logo />
          </Link>
          <nav className="hidden gap-1 md:flex">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors",
                    active
                      ? "bg-gradient-brand text-primary-foreground shadow-glow"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-6 md:pb-10">{children}</main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed bottom-3 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full border border-border/60 bg-card/80 p-1.5 shadow-glow backdrop-blur-xl md:hidden">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-w-14 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-colors",
                active
                  ? "bg-gradient-brand text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
