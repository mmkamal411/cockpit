"use client";

/** Features — the sales pitch: everything a pilot's day touches, in one
 *  cockpit. Static, honest copy; no feature promises beyond what the
 *  product does today. */

const FEATURES = [
  {
    glyph: "✓",
    title: "Tasks & lists",
    body: "Your to-dos, shopping lists, and reminders in one place — shared with the people you choose, synced across devices.",
  },
  {
    glyph: "◈",
    title: "School",
    body: "Grades, assignments, and class schedules pulled together, so the gap between now and the goal is always visible — never buried.",
  },
  {
    glyph: "♥",
    title: "Health",
    body: "Steps, sleep, and workouts woven into your day. Crystal notices patterns and nudges — gently, never nagging.",
  },
  {
    glyph: "◎",
    title: "Money",
    body: "Bills, subscriptions, and spending at a glance. Crystal reminds you before a bill is due, not after.",
  },
  {
    glyph: "✉",
    title: "Communication",
    body: "Mail and messages distilled to what matters. The important thread finds you; the noise stays parked.",
  },
  {
    glyph: "✦",
    title: "One calm command deck",
    body: "Five areas of life, one morning ritual. Crystal watches the details so you can fly the day instead of filing it.",
  },
] as const;

export function LandingFeatures() {
  return (
    <section aria-labelledby="features-heading" className="relative bg-abyss px-6 py-20 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.3em] text-neon-teal">
          One cockpit
        </p>
        <h2
          id="features-heading"
          className="mx-auto mt-3 max-w-2xl text-center text-3xl font-semibold tracking-tight text-star sm:text-4xl"
        >
          Your whole day, finally in one place
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-stardust sm:text-base">
          No more app-hopping. Crystal gathers the threads of your life —
          tasks, school, health, money, messages — into a single calm view.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="rounded-2xl border border-line bg-panel/60 p-6 backdrop-blur-md transition-colors hover:border-neon-teal/30"
            >
              <p aria-hidden="true" className="text-2xl text-neon-teal">
                {f.glyph}
              </p>
              <h3 className="mt-3 text-base font-semibold text-star">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stardust">{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
