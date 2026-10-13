/**
 * Toolbar variant switcher — the showcase flag.
 *
 * Meheldi picks the winning design direction by flipping this constant.
 * 'legacy'   = current toolbar.tsx (pre-redesign)
 * 'console'  = Cockpit Console — machined key bank, teal light strip
 * 'dash'     = Panoramic Dash — arched console, stations on an arc
 * 'hologlass'= Hologlass — near-invisible plate, projected-light keys
 *
 * Revert = set to 'legacy', commit, push. Under 3 minutes.
 * See docs/TOOLBAR-REDESIGN-REVERT-PLAN.md for the full revert procedure.
 */
export const TOOLBAR_VARIANT: "legacy" | "console" | "dash" | "hologlass" =
  "hologlass";
