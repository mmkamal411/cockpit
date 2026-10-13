# BILLSCAN-UX — "Scan a bill" feature spec

**Scope:** Bills applet → "Add bill" tab. **Owner:** implementation team.
**Related file:** `src/components/applets/bills-applet.tsx` (Add-bill form, `view === "add"`).
**Theme:** dark spacecraft cockpit; Bills module accent = `text-neon-amber`, soft amber fills `bg-neon-amber/10` with `border-neon-amber/40`.
**Platforms:** mobile-first (Meheldi uses iOS); desktop file-picker fallback.

---

## 1. "Scan a bill" button

**Placement:** first element inside the Add-bill form — directly below the
`<h3>Add a bill</h3>` heading and above the Name field. (It sits at the top so
a returning scanner never has to scroll past empty fields.)

**Visual style:** full-width, secondary (visually quieter than the primary
"Add bill" submit). Match the existing Bills patterns:

- Layout: `w-full rounded-xl border px-4 py-2.5 text-sm font-medium`
- Border/fill: `border-line bg-panel-2/60 text-stardust hover:text-star` —
  deliberately NOT the amber `border-neon-amber/40 bg-neon-amber/10` treatment,
  so the submit button stays the loudest thing on screen.
- Icon: small inline camera icon (24px, 1.5px stroke, currentColor) to the
  left of the label. Do not use an emoji.
- Min touch target: 44px height (py-2.5 already meets this; keep it).

**Exact label text:**

> Scan a bill

(Keep the capital-S lowercase-b sentence case to match "Add bill".)

**Behavior:** tap opens the **pre-scan disclaimer dialog** (§2) — never the
camera directly.

---

## 2. Pre-scan disclaimer dialog (gate — MUST appear before camera opens)

The camera or file picker must never open until the user taps
"I understand — scan the bill". No pre-ticked checkboxes anywhere in this flow.

**Layout:** centered modal over a dimmed backdrop (reuse the app's standard
modal pattern). Max width `max-w-sm`, padding `p-5`, panel style
`rounded-2xl border border-line bg-panel-2`, heading `text-base font-semibold
text-star`, body `text-sm leading-relaxed text-stardust`.

**Exact copy:**

- **Title:** `Before you scan`
- **Body (3 short sentences, verbatim):**
  > Your photo is read on this device to fill in the form — nothing is sent
  > anywhere. The photo is thrown away right after and is never saved, stored,
  > or shared. You're choosing to do this yourself, and nothing fills in or
  > saves until you check it and tap "Add bill".
- **Primary consent button (exact text):** `I understand — scan the bill`
  - Style: primary-equivalent — `w-full rounded-xl border border-neon-amber/40
    bg-neon-amber/10 px-4 py-2.5 text-sm font-medium text-neon-amber
    hover:bg-neon-amber/20`. Full width, 44px+ target.
  - Behavior: dismisses dialog → launches camera (mobile) / file picker
    (desktop) per §3.
- **Secondary dismiss button (exact text):** `Not now`
  - Style: quiet secondary — `w-full rounded-xl border border-line px-4 py-2.5
    text-sm text-dim hover:text-star` (placed below the primary, or as a
    plain text button beneath it — pick one and stay consistent).
  - Behavior: closes dialog, returns to the Add-bill form untouched. No
    camera, no picker, no state change.

Do not add a third action (no "Learn more" link — the body already says it).

---

## 3. Camera / file capture

- **Mobile (iOS Safari):** hidden `<input type="file" accept="image/*"
  capture="environment" />`. `capture="environment"` prefers the rear camera —
  bills are photographed, not selfie'd.
- **Desktop / non-camera devices:** plain `<input type="file" accept="image/*"
  />` — the OS file picker. Same consent dialog precedes it.
- **Permission denied / camera blocked (copy, verbatim):**
  > We couldn't open your camera. You can pick a photo instead — or type the
  > bill in below. Nothing was saved.
  - Present as an inline notice in the form (not a dialog) with a secondary
    "Choose a photo" button that re-opens the file picker without
    `capture`. The form below stays fully usable.

---

## 4. Scanning state

While OCR runs, replace the form area (or overlay it) with a dedicated
scanning state — never leave the user staring at an unchanged form:

- A spinner (respect `prefers-reduced-motion`: swap to a static amber ring
  icon + text when reduced motion is on).
- **Status line (exact text):** `Reading your bill…`
- **Cancel control (exact text):** `Cancel`
  - Style: quiet secondary button beneath the spinner.
  - Behavior: cancels OCR work immediately, discards any in-progress image
    data, returns to the clean Add-bill form. The image is thrown away at
    cancel time too.

**aria-live:** the scanning status region must be `aria-live="polite"` so
screen readers announce "Reading your bill…", then the outcome.

---

## 5. OCR success — suggested fields

When OCR returns values, pre-fill the matching fields and mark them as
guesses — the user reviews everything before anything saves.

**Suggestion banner (exact text, verbatim), shown once above the form:**

> We filled in what we could read — please check before saving.

- Style: `rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-4 py-2.5
  text-xs leading-relaxed text-neon-amber`. Non-blocking; it never covers a
  field.
- Per-field marker: each pre-filled field gets a small amber hint directly
  under its label (exact text): `Suggested — check me`
  - Style: `text-[11px] text-neon-amber/90`. Example: Name label row shows
    "Name" (existing label) plus this hint; the input keeps its normal class
    (`focus:border-neon-amber/60`) so editing feels identical to manual entry.

**Rules:**

- Every pre-filled value is fully editable, clearable, and re-typable.
- Nothing saves until the user taps "Add bill" — the existing submit flow is
  unchanged (same validation: Name required → "Give the bill a name.").
- Clearing a suggested field removes its "Suggested — check me" hint (an
  edited/empty field is the user's, not a guess).
- Do NOT auto-advance the view or auto-submit.

---

## 6. OCR failure / nothing found

**Copy (verbatim), shown inline at the top of the form:**

> We couldn't read that bill. You can type it in below — nothing was saved.

- Style: `rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-xs
  leading-relaxed text-stardust`. Reassuring, not red — this is not an error
  banner; treat it as an empty-state message.
- The form stays exactly as it was: all fields usable, no modal, no dead end.
- Offer a secondary retry button labeled `Try again` (exact text) that
  re-opens the disclaimer-accepted capture flow directly (consent stands for
  this attempt; do not re-show the dialog on retry within the same session).

---

## 7. Partial reads

If OCR finds some fields but not others (e.g. amount found, due date missing):

- Pre-fill the fields that were found, leave the rest blank.
- The same banner (§5) and the same per-field `Suggested — check me` hints
  apply to whichever fields were filled.
- Blank fields carry no hint — they're simply empty.
- This is the normal case, not a failure: do not show the §6 copy alongside
  a partial success.

**Confident vs. weak guesses:** if a value's OCR confidence is below the
engine's usable threshold, treat it as missing (leave blank) rather than
pre-filling a likely-wrong guess. Better an empty field than a wrong "suggest
me".

---

## 8. Accessibility

- **Dialog:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
  pointing at the dialog title ("Before you scan").
- **Focus trap:** focus moves into the dialog on open (to the primary consent
  button), Tab cycles within it, Esc closes as "Not now". On close, focus
  returns to the "Scan a bill" button.
- **Status:** scanning + result states announced via a single
  `aria-live="polite"` region (do not create a second live region).
- **Labels:** every control labeled — the hidden file input gets
  `aria-label="Scan a bill"`, the Cancel button is real text (not an icon
  alone), the retry button is real text.
- **Reduced motion:** honor `prefers-reduced-motion` for the spinner (static
  indicator + text) and suppress any transition/animation on the banner.
- **375px layout:** full-width buttons stack; dialog fits within the viewport
  with safe-area padding; nothing requires horizontal scroll.

---

## 9. What NOT to do

- **No auto-save of OCR guesses** — values sit in the form only; "Add bill"
  is the only save path.
- **No storing the image** — not on the device, not in the app, not on any
  server. Read it, fill the form, throw it away. Cancel and permission-denied
  paths discard it too.
- **No pre-ticked consent** — the dialog's single explicit "I understand —
  scan the bill" button is the consent control; never a checkbox, never
  pre-checked.
- **No dead ends** — every failure path (§3, §6) leaves the manual form
  usable with a clear next step.
- **No jargon in user copy** — all strings above pass the grandmother test;
  do not substitute "parse", "OCR", "confidence threshold", or "persist".
