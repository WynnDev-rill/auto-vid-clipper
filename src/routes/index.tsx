import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Wand2, Youtube, Zap, Type, Sparkles, ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClipForge AI — Turn long videos into viral shorts" },
      {
        name: "description",
        content:
          "Automatically generate vertical short clips from your long videos and upload them to YouTube. AI highlights, subtitles, and metadata built in.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  { icon: Wand2, title: "AI highlight detection", body: "Finds the most engaging moments automatically." },
  { icon: Type, title: "Auto subtitles", body: "5 templates including TikTok and Hormozi styles." },
  { icon: Sparkles, title: "Titles & hashtags", body: "SEO-ready metadata generated for every clip." },
  { icon: Youtube, title: "Direct YouTube upload", body: "Publish, draft, or schedule with one tap." },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-6">
        <Logo />
        <Link
          to="/auth"
          className="rounded-full border border-border/70 bg-card/60 px-4 py-2 text-sm font-medium backdrop-blur"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-6 md:px-6 md:pt-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Zap size={12} className="text-brand-purple" /> AI-powered short-form for creators
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl font-display text-4xl font-bold tracking-tight md:text-6xl">
            Turn long videos into <span className="text-gradient-brand">viral shorts</span>, on autopilot.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
            Paste a link or upload your video. ClipForge AI finds the best moments, generates subtitles,
            writes the metadata, and ships them straight to your YouTube channel.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              Get started free <ArrowRight size={16} />
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-6 py-3 text-sm font-medium backdrop-blur"
            >
              I already have an account
            </Link>
          </div>
        </motion.div>

        {/* Preview card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="card-elevated mx-auto mt-14 max-w-3xl overflow-hidden p-6"
        >
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950"
              >
                <div className="absolute inset-0 bg-gradient-brand-soft" />
                <div className="absolute inset-x-3 bottom-4 text-center">
                  <div className="text-xs font-semibold text-white/90">Clip {i}</div>
                  <div className="mt-1 font-display text-sm font-bold text-white">
                    This changed <span className="text-brand-cyan">everything</span> 🔥
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="mx-auto mt-20 grid max-w-6xl gap-4 px-4 pb-24 md:grid-cols-2 md:px-6 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="card-elevated p-5">
            <div className="grid size-10 place-items-center rounded-2xl bg-gradient-brand shadow-glow">
              <Icon size={18} className="text-primary-foreground" />
            </div>
            <h3 className="mt-4 font-display text-base font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
