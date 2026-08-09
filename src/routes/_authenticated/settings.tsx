import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Youtube, LogOut, Bell, Sparkles, Loader2, PlugZap, Activity, Mic } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { getYouTubeConnection, disconnectYouTube } from "@/lib/youtube.functions";
import { YOUTUBE_PROVIDER_SCOPES } from "@/lib/youtube-provider.client";
import { getSettings, updateSettings } from "@/lib/analytics.functions";
import {
  getWhisperProviderInfo,
  setWhisperProviderPreference,
  type WhisperProvider,
} from "@/lib/worker-settings.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — ClipForge AI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ytFn = useServerFn(getYouTubeConnection);
  const disFn = useServerFn(disconnectYouTube);
  const sFn = useServerFn(getSettings);
  const upFn = useServerFn(updateSettings);
  const whisperGetFn = useServerFn(getWhisperProviderInfo);
  const whisperSetFn = useServerFn(setWhisperProviderPreference);

  const yt = useQuery({ queryKey: ["yt-connection"], queryFn: () => ytFn(), refetchOnWindowFocus: true });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => sFn() });
  const whisper = useQuery({ queryKey: ["whisper-provider"], queryFn: () => whisperGetFn() });

  const connect = useMutation({
    mutationFn: async () => {
      const nativeShell = /(?:^|\s)ClipForge\//.test(navigator.userAgent);
      const callback = new URL("/auth", window.location.origin);
      callback.searchParams.set("redirect", "/settings");
      callback.searchParams.set("youtube", "1");
      if (nativeShell) callback.searchParams.set("native", "1");

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback.toString(),
          skipBrowserRedirect: nativeShell,
          scopes: YOUTUBE_PROVIDER_SCOPES,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Google did not return an authorization URL.");

      if (nativeShell && window.ClipForgeNative?.openExternal) {
        window.ClipForgeNative.openExternal(data.url);
        return;
      }
      window.location.assign(data.url);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not start YouTube authorization");
    },
  });

  const disconnect = useMutation({
    mutationFn: () => disFn(),
    onSuccess: () => {
      toast.success("YouTube disconnected");
      qc.invalidateQueries({ queryKey: ["yt-connection"] });
    },
  });

  const updSettings = useMutation({
    mutationFn: (patch: { notifications_enabled?: boolean; theme?: "dark" | "light" }) => upFn({ data: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const updWhisper = useMutation({
    mutationFn: (provider: WhisperProvider) => whisperSetFn({ data: { provider } }),
    onSuccess: (r) => {
      toast.success(`Whisper provider set to ${r.provider}`);
      qc.invalidateQueries({ queryKey: ["whisper-provider"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to update provider");
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (yt.isLoading || settings.isLoading || !yt.data || !settings.data) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const conn = yt.data.connection;
  const s = settings.data.settings;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Settings</p>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Preferences & connections</h1>
        </div>
        <Link to="/diagnostics" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs">
          <Activity size={12} /> Diagnostics
        </Link>
      </div>

      <GradientCard>
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-brand shadow-glow">
            <Youtube size={18} className="text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">YouTube channel</p>
            {conn ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">{conn.channel_title}</p>
                <p className={`mt-1 text-xs ${yt.data.ready ? "text-success" : "text-warning"}`}>
                  {yt.data.ready
                    ? "Ready. Newly generated clips will be uploaded automatically as Unlisted."
                    : "Authorization expired. Reconnect before generating new clips."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!yt.data.ready ? (
                    <button
                      onClick={() => connect.mutate()}
                      disabled={connect.isPending}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
                    >
                      {connect.isPending ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
                      Reconnect YouTube
                    </button>
                  ) : null}
                  <button
                    onClick={() => disconnect.mutate()}
                    className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect Google once to grant YouTube upload permission. ClipForge will then upload newly generated clips automatically as Unlisted.
                </p>
                <button
                  onClick={() => connect.mutate()}
                  disabled={connect.isPending}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
                >
                  {connect.isPending ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
                  Connect YouTube
                </button>
              </>
            )}
          </div>
        </div>
      </GradientCard>

      <GradientCard>
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-brand-soft">
            <Sparkles size={18} className="text-brand-purple" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Highlight engine</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Uses the configured AI scorer when available, with a deterministic fallback so generation does not fail just because an AI gateway is unavailable.
            </p>
          </div>
        </div>
      </GradientCard>

      <GradientCard>
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-brand-soft">
            <Mic size={18} className="text-brand-purple" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Whisper provider</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Auto tries Groq → OpenAI → OpenRouter. If every provider is unavailable, ClipForge falls back to subtitle-free clip selection instead of killing the whole job.
            </p>

            {whisper.isLoading ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading provider settings…
              </div>
            ) : !whisper.data?.configured ? (
              <p className="mt-3 text-xs text-destructive">Render worker is not reachable.</p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["auto", "groq", "openai", "openrouter"] as WhisperProvider[]).map((p) => {
                    const active = whisper.data!.provider === p;
                    const disabled = p !== "auto" && !whisper.data!.available[p as "groq" | "openai" | "openrouter"];
                    return (
                      <button
                        key={p}
                        onClick={() => updWhisper.mutate(p)}
                        disabled={disabled || updWhisper.isPending}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${
                          active
                            ? "border-transparent bg-gradient-brand text-primary-foreground shadow-glow"
                            : "border-border bg-secondary/40 text-foreground"
                        } disabled:opacity-40`}
                      >
                        {p === "auto" ? "Auto (Recommended)" : p}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>
                    Selected: <span className="font-semibold text-foreground">{whisper.data.provider}</span>
                    {whisper.data.lastUsedProvider ? <>{" · Last used: "}<span className="font-semibold text-brand-cyan">{whisper.data.lastUsedProvider}</span></> : null}
                  </p>
                  <p>
                    Keys detected: {(["groq", "openai", "openrouter"] as const)
                      .map((k) => `${k}: ${whisper.data!.available[k] ? "✓" : "—"}`)
                      .join(" · ")}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </GradientCard>

      <GradientCard>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-secondary"><Bell size={18} /></div>
            <div>
              <p className="font-semibold">Notifications</p>
              <p className="text-sm text-muted-foreground">Job status toasts</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={!!s.notifications_enabled}
            onChange={(e) => updSettings.mutate({ notifications_enabled: e.target.checked })}
            className="size-5 accent-[oklch(0.68_0.22_295)]"
          />
        </div>
      </GradientCard>

      <button
        onClick={signOut}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
      >
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
