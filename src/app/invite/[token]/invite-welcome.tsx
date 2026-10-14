"use client";

import { useRouter } from "next/navigation";
import { openApplet } from "@/lib/applet-bus";

/**
 * The first-run moment for an invitee: one screen, then straight into the
 * shared list. Not a tour — a welcome and a door.
 */
export function InviteWelcome({
  listId,
  listName,
  ownerName,
  permission,
  already,
  kind = "shopping",
}: {
  listId: string;
  listName: string;
  ownerName: string;
  permission: "view" | "edit";
  already: boolean;
  kind?: "shopping" | "todo";
}) {
  const router = useRouter();

  function openList() {
    // The applet bus is module-level state: opening before navigating keeps
    // the shared list active once /home mounts its applet host.
    if (kind === "todo") {
      openApplet("today", { list: listId, welcome: "1" });
    } else {
      openApplet("shopping", { list: listId, welcome: "1" });
    }
    router.push("/home");
  }

  const itemNoun = kind === "todo" ? "tasks" : "items";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel-2/60 p-8 text-center">
        <p aria-hidden="true" className="text-5xl">🎉</p>
        <h1 className="mt-4 text-xl font-semibold text-star">
          {already ? "Welcome back" : "Welcome to Crystal"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stardust">
          <strong className="text-star">{ownerName}</strong> shared their{" "}
          <strong className="text-star">&ldquo;{listName}&rdquo;</strong> list with you
          {permission === "edit"
            ? ` — you can add ${itemNoun} and check things off together.`
            : " — you can follow along as it updates."}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-dim">
          Crystal is your personal command center — lists, bills, health, and more.
          Take a look around whenever you like.
        </p>
        <button
          type="button"
          onClick={openList}
          className="mt-6 w-full rounded-xl border border-neon-green/40 bg-neon-green/10 px-6 py-3 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
        >
          Open the shared list
        </button>
      </div>
    </div>
  );
}
