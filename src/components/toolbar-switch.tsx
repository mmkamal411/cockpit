"use client";

import { TOOLBAR_VARIANT } from "./toolbar-variant";
import { ToolbarLegacy } from "./toolbar-legacy";
// Variant components land here as they are built:
// import { ToolbarConsole } from "./toolbar-console";
// import { ToolbarDash } from "./toolbar-dash";
// import { ToolbarHologlass } from "./toolbar-hologlass";

/**
 * ToolbarSwitch — renders the active toolbar variant per TOOLBAR_VARIANT.
 * Flip the flag in toolbar-variant.ts to showcase a different direction.
 */
export function ToolbarSwitch() {
  switch (TOOLBAR_VARIANT) {
    case "console":
      // return <ToolbarConsole />;
      return <ToolbarLegacy />; // TODO: console variant not built yet
    case "dash":
      // return <ToolbarDash />;
      return <ToolbarLegacy />; // TODO: dash variant not built yet
    case "hologlass":
      // return <ToolbarHologlass />;
      return <ToolbarLegacy />; // TODO: hologlass variant not built yet
    case "legacy":
    default:
      return <ToolbarLegacy />;
  }
}
