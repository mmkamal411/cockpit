"use client";

import { TOOLBAR_VARIANT } from "./toolbar-variant";
import { ToolbarLegacy } from "./toolbar-legacy";
import { ToolbarConsole } from "./toolbar-console";
import { ToolbarDash } from "./toolbar-dash";
import { ToolbarHologlass } from "./toolbar-hologlass";
import { ToolbarPanoramic } from "./toolbar-panoramic";
import { ToolbarStarcraft } from "./toolbar-starcraft";

/**
 * ToolbarSwitch — renders the active toolbar variant per TOOLBAR_VARIANT.
 * Flip the flag in toolbar-variant.ts to showcase a different direction.
 * Revert = set to 'legacy', commit, push. Under 3 minutes.
 */
export function ToolbarSwitch() {
  switch (TOOLBAR_VARIANT) {
    case "console":
      return <ToolbarConsole />;
    case "dash":
      return <ToolbarDash />;
    case "hologlass":
      return <ToolbarHologlass />;
    case "panoramic":
      return <ToolbarPanoramic />;
    case "starcraft":
      return <ToolbarStarcraft />;
    case "legacy":
    default:
      return <ToolbarLegacy />;
  }
}
