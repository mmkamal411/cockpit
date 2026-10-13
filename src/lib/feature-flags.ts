/**
 * Feature flags — showcase variants for the toolbar and station deck.
 *
 * Each flag is an independent code constant (not an env var): flipping one
 * never affects the other. Revert = set the flag back to "legacy", commit,
 * push — the Git-connected Pages project redeploys automatically.
 *
 * - TOOLBAR_VARIANT: owned by the toolbar-showcase branch.
 * - STATION_DECK_VARIANT: owned by the station-deck-showcase branch.
 */

/** Which toolbar chrome is live. */
export type ToolbarVariant = "legacy" | "console" | "dash" | "hologlass";
export const TOOLBAR_VARIANT: ToolbarVariant = "legacy";

/** Which "More" surface is live. "legacy" = the original More list. */
export type StationDeckVariant = "legacy" | "bays" | "ecam" | "grid";
export const STATION_DECK_VARIANT: StationDeckVariant = "grid";
