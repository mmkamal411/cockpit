/**
 * Toolbar variant switcher — the showcase flag.
 *
 * Meheldi picks the winning design direction by flipping this constant.
 * 'legacy'   = current toolbar.tsx (pre-redesign)
 * 'console'  = Cockpit Console — machined key bank, teal light strip
 * 'dash'     = Panoramic Dash — arched console, stations on an arc
 * 'hologlass'= Hologlass — near-invisible plate, projected-light keys
 * 'panoramic'= Panoramic Cockpit — full-width trapezoidal dash, status
 *              strip, central orb command, pilot info bar
 * 'starcraft'= StarCraft command center — 3x3 ability grid with cooldowns,
 *              radar sweep, squad status, feed tickers, Red Alert (Team Toolbar)
 *
 * Revert = set to 'legacy', commit, push. Under 3 minutes.
 * See docs/TOOLBAR-REDESIGN-REVERT-PLAN.md for the full revert procedure.
 */
export const TOOLBAR_VARIANT:
  | "legacy"
  | "console"
  | "dash"
  | "hologlass"
  | "panoramic"
  | "starcraft" = "starcraft";
