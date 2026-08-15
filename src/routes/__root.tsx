import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import nativeCss from "../native-fixes.css?url";

function NotFoundComponent() {
  return <div className="flex min-h-screen items-center justify-center px-4"><div className="max-w-md text-center"><h1 className="font-display text-6xl font-bold text-gradient-brand">404</h1><p className="mt-3 text-sm text-muted-foreground">Page not found.</p><a href="/create" className="mt-5 inline-flex rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-primary-foreground">Create clip</a></div></div>;
}
function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return <div className="flex min-h-screen items-center justify-center px-4"><div className="max-w-md text-center"><h1 className="font-display text-xl font-semibold">This page did not load</h1><p className="mt-2 text-sm text-muted-foreground">{error.message || "Something went wrong."}</p><button onClick={reset} className="mt-5 rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-primary-foreground">Try again</button></div></div>;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#071022" },
      { title: "ClipForge — Find the best moments" },
      { name: "description", content: "Turn long videos into ranked short-form moments, edit the best ones, and export them." },
    ],
    links: [
      { rel: "stylesheet", href: appCss }, { rel: "stylesheet", href: nativeCss }, { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" },
    ],
  }),
  shellComponent: RootShell, component: RootComponent, notFoundComponent: NotFoundComponent, errorComponent: ErrorComponent,
});
function RootShell({ children }: { children: ReactNode }) { return <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>; }
function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => { document.documentElement.classList.toggle("clipforge-native", /(?:^|\s)ClipForge\//.test(navigator.userAgent)); }, []);
  return <QueryClientProvider client={queryClient}><Outlet /><Toaster theme="dark" position="top-center" richColors /></QueryClientProvider>;
}
