"use client";

import Link from "next/link";

/** Meet Crystal — who the co-pilot is. Warm, plain-spoken, honest about
 *  what the AI does and doesn't do. */

const TRAITS = [
  {
    title: "Soothing, not shouty",
    body: "Crystal drifts through your day at your pace. Urgent things surface calmly; everything else waits its turn.",
  },
  {
    title: "Proactive, not passive",
    body: "She watches your patterns — a bill about to slip, a grade drifting, a busy morning — and flags it before it costs you.",
  },
  {
    title: "Yours, not everyone's",
    body: "Your habits shape your cockpit. Nothing you teach Crystal ever leaks into anyone else's — your profile stays on your account.",
  },
  {
    title: "Honest about limits",
    body: "Crystal isn't a doctor, a lawyer, or a financial advisor. She organizes your life; the big calls stay yours.",
  },
] as const;

export function MeetCrystal() {
  return (
    <section
      aria-labelledby="meet-crystal-heading"
      className="relative overflow-hidden bg-panel px-6 py-20 sm:px-10"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(94_234_212/0.08)_0%,rgb(94_234_212/0)_100%)]"
      />
      <div className="relative mx-auto max-w-5xl">
        <div className="flex flex-col items-center text-center">
          <span aria-hidden="true" className="meet-crystal-orb" />
          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.3em] text-neon-teal">
            Meet your co-pilot
          </p>
          <h2
            id="meet-crystal-heading"
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-star sm:text-4xl"
          >
            Crystal flies beside you
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-stardust sm:text-base">
            A ball of light on your toolbar — an intelligence that knows your
            rhythm. She greets your mornings, watches your day, and keeps the
            thousand small things from becoming ten big problems.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {TRAITS.map((t) => (
            <article
              key={t.title}
              className="rounded-2xl border border-line bg-panel-2/60 p-6 backdrop-blur-md"
            >
              <h3 className="text-base font-semibold text-star">{t.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stardust">{t.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="#signup"
            className="inline-block rounded-full border border-neon-teal/50 bg-neon-teal/15 px-8 py-3 text-sm font-semibold text-star shadow-[0_0_28px_rgb(94_234_212/0.2)] backdrop-blur-md transition-all hover:bg-neon-teal/25"
          >
            Meet Crystal — sign up free
          </Link>
        </div>
      </div>
      <style>{MEET_CRYSTAL_CSS}</style>
    </section>
  );
}

const MEET_CRYSTAL_CSS = `
.meet-crystal-orb {
  width: 88px; height: 88px; border-radius: 9999px; display: inline-block;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 36%),
    radial-gradient(circle at 50% 55%, #d8fff4 0%, #5eead4 42%, #0e7d6c 78%, #04211c 100%);
  box-shadow: 0 0 28px rgb(94 234 212 / 0.6), 0 0 80px rgb(94 234 212 / 0.25);
}
@media (prefers-reduced-motion: no-preference) {
  .meet-crystal-orb { animation: orb-breathe 6s ease-in-out infinite; }
  @keyframes orb-breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.06); }
  }
}
`;
