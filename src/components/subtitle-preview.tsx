import type { SubtitleStyle } from "@/types/domain";

export function SubtitlePreview({
  style,
  text = "This changed everything",
  highlightWord = "everything",
}: {
  style: SubtitleStyle;
  text?: string;
  highlightWord?: string;
}) {
  const words = text.split(" ");
  const positionClass =
    style.position === "top" ? "top-6" : style.position === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-8";

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-slate-800 to-slate-950">
      <div className="absolute inset-0 bg-gradient-brand-soft opacity-60" />
      <div className={`absolute left-1/2 w-[85%] -translate-x-1/2 text-center ${positionClass}`}>
        <div
          className="font-display font-bold leading-tight"
          style={{
            fontSize: style.fontSize,
            color: style.color,
            WebkitTextStroke: `${style.strokeWidth}px ${style.stroke}`,
            textShadow: `0 2px 6px rgba(0,0,0,0.6)`,
          }}
        >
          {words.map((w, i) => (
            <span
              key={i}
              style={{
                color: w.toLowerCase().replace(/[^a-z]/g, "") === highlightWord ? style.highlightColor : style.color,
              }}
            >
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
          {style.emojis ? " 🔥" : null}
        </div>
      </div>
    </div>
  );
}
