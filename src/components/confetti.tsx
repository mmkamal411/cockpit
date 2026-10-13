"use client";

/**
 * Lightweight CSS confetti — no dependencies. Renders a burst of falling
 * bits over its positioned parent. Respects prefers-reduced-motion.
 */
export function Confetti({ pieces = 28 }: { pieces?: number }) {
  const colors = ["#a3e635", "#22d3ee", "#f472b6", "#fbbf24", "#c084fc"];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: pieces }).map((_, i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 9) * 0.07}s`,
          }}
        />
      ))}
      <style>{`.confetti-bit{position:absolute;top:-10px;width:7px;height:10px;border-radius:2px;animation:confetti-fall 1.8s ease-in forwards}@keyframes confetti-fall{to{transform:translateY(260px) rotate(540deg);opacity:0}}@media (prefers-reduced-motion: reduce){.confetti-bit{display:none}}`}</style>
    </div>
  );
}
