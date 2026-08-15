import { Link, useRouterState } from "@tanstack/react-router";
import { FolderClock, Settings, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/create", label: "Create", icon: Sparkles },
  { to: "/jobs", label: "Projects", icon: FolderClock },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#071022]">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-4 md:h-[76px] md:px-6">
          <Link to="/create" className="focus:outline-none" aria-label="ClipForge create">
            <Logo size={20} />
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
                    "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/12 text-brand-blue"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon size={17} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-[104px] pt-5 md:px-6 md:pb-10">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#071022] md:hidden"
        aria-label="Main navigation"
      >
        <div className="mx-auto flex h-[78px] max-w-xl items-stretch px-4 pb-1">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 px-1 text-[11px] font-medium leading-none transition-colors",
                  active ? "text-brand-blue" : "text-muted-foreground",
                )}
              >
                {active ? <span className="absolute inset-x-1 top-0 mx-auto h-[3px] w-12 rounded-full bg-brand-blue" /> : null}
                <Icon size={23} strokeWidth={active ? 2.5 : 2} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
