import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Download, Loader2, LogOut, PlugZap, RefreshCw, Youtube } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { getYouTubeConnection, disconnectYouTube } from "@/lib/youtube.functions";
import { YOUTUBE_PROVIDER_SCOPES } from "@/lib/youtube-provider";
import { getSettings, updateSettings } from "@/lib/analytics.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — ClipForge" }] }),
  component: SettingsPage,
});

type ReleaseInfo = {
  tag_name: string;
  html_url: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
};

function currentAppVersion() {
  const native = (window as unknown as { ClipForgeNative?: { getAppVersion?: () => string } }).ClipForgeNative;
  try {
    const value = native?.getAppVersion?.();
    if (value) return value;
  } catch {}
  const match = navigator.userAgent.match(/(?:^|\s)ClipForge\/([^\s]+)/);
  return match?.[1] ?? "web";
}

function versionParts(value: string) {
  return value.replace(/^v/i, "").split(/[.-]/).map((part) => Number(part)).filter(Number.isFinite).slice(0, 3);
}

function isNewer(latest: string, installed: string) {
  if (installed === "web") return false;
  const a = versionParts(latest);
  const b = versionParts(installed);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function SettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ytFn = useServerFn(getYouTubeConnection);
  const disFn = useServerFn(disconnectYouTube);
  const sFn = useServerFn(getSettings);
  const upFn = useServerFn(updateSettings);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const installedVersion = useMemo(() => currentAppVersion(), []);

  const yt = useQuery({ queryKey: ["yt-connection"], queryFn: () => ytFn(), refetchOnWindowFocus: true });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => sFn() });

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
          queryParams: { access_type: "offline", prompt: "consent" },
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
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Could not connect YouTube"),
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

  async function checkUpdate() {
    setCheckingUpdate(true);
    try {
      const response = await fetch("https://api.github.com/repos/WynnDev-rill/auto-vid-clipper/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(response.status === 404 ? "No APK release is published yet." : `Update check failed (${response.status})`);
      const latest = (await response.json()) as ReleaseInfo;
      setRelease(latest);
      if (isNewer(latest.tag_name, installedVersion)) toast.success(`ClipForge ${latest.tag_name.replace(/^v/, "")} is available`);
      else toast.success("ClipForge is up to date");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not check for updates");
    } finally {
      setCheckingUpdate(false);
    }
  }

  function installUpdate() {
    if (!release) return;
    const apk = release.assets?.find((asset) => asset.name.toLowerCase().endsWith(".apk"));
    const url = apk?.browser_download_url ?? release.html_url;
    const native = (window as unknown as { ClipForgeNative?: { openUpdateUrl?: (url: string) => void } }).ClipForgeNative;
    try {
      if (native?.openUpdateUrl) native.openUpdateUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.location.assign(release.html_url);
    }
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (yt.isLoading || settings.isLoading || !yt.data || !settings.data) {
    return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  }

  const conn = yt.data.connection;
  const s = settings.data.settings;
  const updateAvailable = release ? isNewer(release.tag_name, installedVersion) : false;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">ClipForge</p>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Settings</h1>
      </div>

      <GradientCard>
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-brand shadow-glow"><Download size={18} className="text-primary-foreground" /></div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">App update</p>
            <p className="mt-1 text-sm text-muted-foreground">Installed: {installedVersion === "web" ? "Web app" : `v${installedVersion}`}</p>
            {release ? <p className={`mt-1 text-xs ${updateAvailable ? "text-brand-cyan" : "text-muted-foreground"}`}>{updateAvailable ? `${release.tag_name} is ready to install` : `Latest: ${release.tag_name}`}</p> : null}
            <div className="mt-3 flex gap-2">
              <button onClick={checkUpdate} disabled={checkingUpdate} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
                {checkingUpdate ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check update
              </button>
              {updateAvailable ? <button onClick={installUpdate} className="rounded-full bg-gradient-brand px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow">Update</button> : null}
            </div>
          </div>
        </div>
      </GradientCard>

      <GradientCard>
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-brand shadow-glow"><Youtube size={18} className="text-primary-foreground" /></div>
          <div className="flex-1">
            <p className="font-semibold">YouTube publishing</p>
            {conn ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">{conn.channel_title}</p>
                <p className="mt-1 text-xs text-muted-foreground">Clips are never uploaded automatically. You choose Publish from a result.</p>
                <div className="mt-3 flex gap-2">
                  {!yt.data.ready ? <button onClick={() => connect.mutate()} disabled={connect.isPending} className="inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1.5 text-xs font-semibold text-primary-foreground"><PlugZap size={12} /> Reconnect</button> : null}
                  <button onClick={() => disconnect.mutate()} className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">Disconnect</button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Optional. Connect YouTube only if you want to publish a selected moment from ClipForge.</p>
                <button onClick={() => connect.mutate()} disabled={connect.isPending} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow disabled:opacity-60">
                  {connect.isPending ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />} Connect YouTube
                </button>
              </>
            )}
          </div>
        </div>
      </GradientCard>

      <GradientCard>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-secondary"><Bell size={18} /></div>
            <div><p className="font-semibold">Notifications</p><p className="text-sm text-muted-foreground">Processing status alerts</p></div>
          </div>
          <input type="checkbox" checked={!!s.notifications_enabled} onChange={(e) => updSettings.mutate({ notifications_enabled: e.target.checked })} className="size-5 accent-[oklch(0.68_0.22_295)]" />
        </div>
      </GradientCard>

      <button onClick={signOut} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"><LogOut size={16} /> Sign out</button>
    </div>
  );
}
