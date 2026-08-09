import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Mail, Lock, Loader2, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/logo";

declare global {
  interface Window {
    ClipForgeNative?: { openExternal: (url: string) => void };
  }
}

const searchSchema = z.object({
  redirect: z.string().optional(),
  // TanStack's default search parser may deserialize `native=1` to the number 1.
  // Normalize it before validation so the OAuth callback cannot 500 during SSR.
  native: z.preprocess(
    (value) => (value == null ? undefined : String(value)),
    z.string().optional(),
  ),
  code: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Sign in — ClipForge AI" },
      { name: "description", content: "Sign in to ClipForge AI to start creating viral short clips." },
    ],
  }),
  component: AuthPage,
});

function safeRedirect(value?: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function isNativeCallback(value?: string) {
  return value === "1" || value === "true";
}

function nativeCallbackLinks(code: string, destination: string) {
  const query = `code=${encodeURIComponent(code)}&redirect=${encodeURIComponent(destination)}`;
  return {
    deepLink: `com.wynndev.clipforge://auth/callback?${query}`,
    // Chrome for Android handles intent:// more reliably for automatic app returns.
    intentLink:
      `intent://auth/callback?${query}` +
      `#Intent;scheme=com.wynndev.clipforge;package=com.wynndev.clipforge;end`,
  };
}

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [nativeReturning, setNativeReturning] = useState(false);
  const destination = safeRedirect(search.redirect);
  const isNativeShell = useMemo(
    () => typeof navigator !== "undefined" && /(?:^|\s)ClipForge\//.test(navigator.userAgent),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function finishCallback() {
      if (search.error) {
        setChecked(true);
        toast.error(search.error_description ?? search.error);
        return;
      }

      // The verifier lives inside the APK WebView. The browser must only return
      // the authorization code to Android, not exchange it itself.
      if (isNativeCallback(search.native) && search.code) {
        setChecked(true);
        setNativeReturning(true);
        const { intentLink } = nativeCallbackLinks(search.code, destination);

        // Deliberately not instant: let the success page settle before bringing
        // the existing ClipForge task back to the foreground.
        timer = window.setTimeout(() => {
          window.location.replace(intentLink);
        }, 1600);
        return;
      }

      if (search.code) {
        setLoading(true);
        const { error } = await supabase.auth.exchangeCodeForSession(search.code);
        if (cancelled) return;
        if (error) {
          toast.error(error.message);
          setLoading(false);
          setChecked(true);
          return;
        }
        window.setTimeout(() => navigate({ to: destination, replace: true }), 250);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) navigate({ to: destination, replace: true });
      else setChecked(true);
    }

    void finishCallback();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [destination, navigate, search.code, search.error, search.error_description, search.native]);

  async function handleGoogle() {
    setLoading(true);
    try {
      const callback = new URL("/auth", window.location.origin);
      callback.searchParams.set("redirect", destination);
      if (isNativeShell) callback.searchParams.set("native", "1");

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback.toString(),
          skipBrowserRedirect: isNativeShell,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Google sign-in URL was not returned.");

      if (isNativeShell && window.ClipForgeNative?.openExternal) {
        window.ClipForgeNative.openExternal(data.url);
        setLoading(false);
        return;
      }

      window.location.assign(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const callback = new URL("/auth", window.location.origin);
        callback.searchParams.set("redirect", destination);
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callback.toString() },
        });
        if (error) throw error;
        toast.success("Account created — check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: destination, replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!checked) return null;

  if (nativeReturning) {
    const { deepLink } = nativeCallbackLinks(search.code ?? "", destination);
    return (
      <div className="flex min-h-screen items-center justify-center px-5 py-10">
        <div className="card-elevated w-full max-w-sm p-7 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-brand shadow-glow">
            <Smartphone size={24} />
          </div>
          <h1 className="mt-5 text-xl font-semibold">Login berhasil</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Mengembalikanmu ke ClipForge…
          </p>
          <Loader2 className="mx-auto mt-5 animate-spin text-brand-purple" />
          <a
            href={deepLink}
            className="mt-6 inline-flex rounded-2xl border border-border px-4 py-2.5 text-sm font-medium"
          >
            Kembali ke ClipForge
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="card-elevated w-full max-w-sm p-6"
      >
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-center font-display text-2xl font-semibold">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to keep forging clips" : "Start turning videos into shorts"}
        </p>

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or email <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <label className="flex items-center gap-2 rounded-2xl border border-input bg-input/30 px-3 py-2.5 focus-within:border-primary">
            <Mail size={16} className="text-muted-foreground" />
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
          <label className="flex items-center gap-2 rounded-2xl border border-input bg-input/30 px-3 py-2.5 focus-within:border-primary">
            <Lock size={16} className="text-muted-foreground" />
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="mt-5 w-full text-center text-xs text-muted-foreground hover:text-foreground">
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </motion.div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.75 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.28-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.85 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.67-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 0 3.99 3.47 2.18 7.05L5.85 9.9C6.72 7.3 9.14 5.38 12 5.38z"/>
    </svg>
  );
}
