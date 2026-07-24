import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Youtube, LogOut, Bell, Sparkles, Loader2, PlugZap, Activity, Mic } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { getYouTubeConnection, startYouTubeConnect, disconnectYouTube } from "@/lib/youtube.functions";
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
  const startFn = useServerFn(startYouTubeConnect);
  const disFn = useServerFn(disconnectYouTube);
  const sFn = useServerFn(getSettings);
  const upFn = useServerFn(updateSettings);

  const yt = useQuery({ queryKey: ["yt-connection"], queryFn: () => ytFn(), refetchOnWindowFocus: false });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => sFn() });

  // Handle OAuth callback redirect: ?yt_connected=1 or ?yt_error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("yt_connected");
    const err = params.get("yt_error");
    if (connected) {
      toast.success("YouTube connected");
      qc.invalidateQueries({ queryKey: ["yt-connection"] });
      qc.invalidateQueries({ queryKey: ["diagnostics"] });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (err) {
      toast.error(`YouTube connect failed: ${err}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [qc]);

  const connect = useMutation({
    mutationFn: () => startFn({ data: { origin: window.location.origin } }),
    onSuccess: (r) => {
      if (!r.configured) {
        toast.error("Google OAuth not configured. Ask an admin to add GOOGLE_OAUTH_CLIENT_ID / SECRET.");
        return;
      }
      if (r.url) window.location.href = r.url;
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
        <Link
          to="/diagnostics"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs"
        >
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
                <button
                  onClick={() => disconnect.mutate()}
                  className="mt-3 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  {yt.data.oauthConfigured
                    ? "Connect your Google account to enable real uploads to your YouTube channel."
                    : "Google OAuth credentials not configured on the server. Ask an admin to set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET."}
                </p>
                <button
                  onClick={() => connect.mutate()}
                  disabled={!yt.data.oauthConfigured || connect.isPending}
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
            <p className="font-semibold">AI provider</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Powered by Lovable AI Gateway — no API keys needed. Titles, descriptions, and hashtags are generated
              through the built-in provider.
            </p>
          </div>
        </div>
      </GradientCard>

      <GradientCard>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-secondary">
              <Bell size={18} />
            </div>
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
        <LogOut size={16} />
        Sign out
      </button>
    </div>
  );
}
