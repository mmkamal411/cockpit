"use client";

import { useState } from "react";
import { newId, readLocal, writeLocal, type CrewMember } from "@/lib/local-store";

const CREW_KEY = "cockpit.crew";

const SYNC_OPTIONS = ["Grades", "Attendance", "Assignments", "School messages"];

type Step = 1 | 2 | 3;

/**
 * Crew — the opt-in family module. Adding a child is entirely optional and
 * lives here, never in onboarding. Three steps: who they are, their school
 * login, what to keep in sync. Saved on this device until cloud crew
 * profiles ship.
 */
export function CrewApplet() {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [district, setDistrict] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sync, setSync] = useState<string[]>(["Grades", "Assignments"]);
  const [added, setAdded] = useState<CrewMember | null>(null);
  const [error, setError] = useState("");

  function toggleSync(option: string) {
    setSync((prev) => (prev.includes(option) ? prev.filter((s) => s !== option) : [...prev, option]));
  }

  function nextFromBasics() {
    if (!name.trim()) {
      setError("Give your crew member a name so Pookie knows who they are.");
      return;
    }
    if (!birthdate) {
      setError("Add a birthdate — it helps Pookie get the details right.");
      return;
    }
    setError("");
    setStep(2);
  }

  function finish() {
    const member: CrewMember = {
      id: newId(),
      name: name.trim(),
      birthdate,
      schoolDistrict: district.trim(),
      sync,
      addedAt: Date.now(),
    };
    const current = readLocal<CrewMember[]>(CREW_KEY, []);
    writeLocal(CREW_KEY, [...current, member]);
    setAdded(member);
  }

  if (added) {
    return (
      <div className="space-y-5 text-center">
        <p aria-hidden="true" className="text-4xl">🛸</p>
        <div>
          <h2 className="text-xl font-semibold text-star">{added.name} is aboard</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-stardust">
            {added.name}&apos;s crew profile is saved on this device. School sync
            will pick up {added.sync.length > 0 ? added.sync.join(", ").toLowerCase() : "nothing yet"}
            {added.schoolDistrict ? ` from ${added.schoolDistrict}` : ""} once the
            school connection is switched on.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAdded(null);
            setStep(1);
            setName("");
            setBirthdate("");
            setDistrict("");
            setUsername("");
            setPassword("");
            setSync(["Grades", "Assignments"]);
            setError("");
          }}
          className="rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
        >
          Add another crew member
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">Crew · step {step} of 3</p>
        <h2 className="mt-1 text-xl font-semibold text-star">
          {step === 1 ? "Who's joining your crew?" : step === 2 ? "School login" : "What should Pookie watch?"}
        </h2>
        <p className="mt-1 text-sm text-stardust">
          {step === 1 && "Just the basics — Pookie handles the rest."}
          {step === 2 && "Their school portal login, so grades and assignments can sync."}
          {step === 3 && "Pick what Pookie keeps an eye on for them."}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm text-neon-amber">
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Their first name"
              autoComplete="off"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">Birthdate</span>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-green/60 focus:outline-none"
            />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">School district</span>
            <input
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              placeholder="e.g. Cobb County School District"
              autoComplete="off"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">Student portal username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Student username or ID"
              autoComplete="off"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">Student portal password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Portal password"
              autoComplete="new-password"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <p className="text-xs leading-relaxed text-dim">
            Saved on this device for now, and used only to pull their school
            information. You can update or remove it anytime.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          {SYNC_OPTIONS.map((option) => {
            const on = sync.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleSync(option)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                  on ? "border-neon-green/40 bg-neon-green/10 text-star" : "border-line bg-panel-2/60 text-stardust hover:border-neon-green/25"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                    on ? "border-neon-green bg-neon-green/25 text-neon-green" : "border-dim/60 text-transparent"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                </span>
                {option}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {step > 1 && (
          <button
            type="button"
            onClick={() => {
              setError("");
              setStep((s) => (s - 1) as Step);
            }}
            className="rounded-xl border border-line bg-panel-2/60 px-5 py-2.5 text-sm font-medium text-stardust transition-colors hover:text-star"
          >
            Back
          </button>
        )}
        {step < 3 ? (
          <button
            type="button"
            onClick={nextFromBasics}
            className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={finish}
            className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Bring them aboard
          </button>
        )}
      </div>
    </div>
  );
}
