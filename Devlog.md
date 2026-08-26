# SmartPantry Devlog

Working notes from taking this from class prototype to real product. Newest first. Format per entry: what shipped, what problem it addressed, what broke along the way, what I learned.

---

## Day 13 — 2026-08-26 — The Cleanup

UI pass: the prototype's fake furniture is gone, and empty is now a
designed state instead of an accident.

**Shipped (`01de43b`):**
- Demo seed data deleted — no more Whole Milk / Greek Yogurt / phantom
  suggestions. The app starts truly empty.
- Home: when nothing needs attention, the section collapses to a
  single module — **"All clear."** in green, "Nothing needs your
  attention." under it. No empty box. "View all" hides with it.
- Pantry empty state: "Your pantry is empty. / Scan a receipt and it
  stocks itself." with a Scan CTA straight to the upload view. Search
  and filter chips hide when there's nothing to search or filter.
- List page rebuilt to its standardized default: header **"Your
  list."**, a live `+ Add an item...` input from first load (type +
  enter adds, × removes), and a muted three-line explainer under the
  empty list ("Add by hand — or scan a receipt. / Every scan teaches
  the pantry what you buy. / The more it knows, the less you type.").
  The explainer yields to real items and returns when the list
  empties; Create List and the Suggested section only render when
  they have something to say. Hand-added rows drop the placeholder-era
  "Manual list item" / "Manual entry" strings.

**Shipped (`d350eb7`):**
- Every pantry row now carries − / + buttons on the left. Taps adjust
  the count by 1 in place — count strings keep their descriptors
  ("4 @ $1.19" steps to "5 @ $1.19", "12 count" to "13 count") — and
  − at qty 1 removes the item, confirm-free.
- Each tap appends `{ item, delta, timestamp }` to a new
  localStorage log (`smartpantry_adjustments`). No UI reads it yet —
  groundwork. Verified: 7 taps, 7 events, exact schema, removal tap
  included.
- Populated pantry carries a permanent whisper line: "+ / − to adjust
  by hand. The pantry keeps count."

**Console-verified flows:** fresh-profile boot shows all three empty
states; list add/remove toggles the explainer both directions; pantry
CTA lands on the upload view; +/− round-trips a scanned qty string
without touching its unit price.

## Day 11 — 2026-08-25 — The Matrix

**Shipped (`edd4de8`):**
- Pantry rows: the Status cycle button is gone (prototype vestige);
  Delete is now **"All done"** — tapping it means "I finished this",
  not "this was a mistake".
- Event log in localStorage (`smartpantry_events`, append-only, no UI
  reads it yet): confirming a receipt writes a `purchase` event per
  item; All done writes a `consumption` event. Schema: name, category,
  qty, price, timestamp, type. Verified in console: 2 purchases + 1
  consumption with correct fields end to end.

**Shipped later that night (`50db93f`):** the scan path now preprocesses
before OCR — 2x upscale (capped near 13MP so mobile canvases survive) +
grayscale + percentile contrast stretch — and runs Tesseract in PSM 6
(single uniform block) instead of default auto-segmentation. First
real-app runs on the Trip 001 receipt, twice, identical: **14/14 items,
zero junk, three quantity lines harvested into the review screen**
(jerky 2 @ $5.99, mango 2 @ $2.49, banana 6 @ $0.29 — every unit price
cross-checks against its line price). Bonus: the upscaled read gets
YOGURT SKYR CHERRY's real name where the old pipeline produced
ER OKYR CHERRY; NAME_MAP gained keys for the new pipeline's reads.

**Shipped, the nightcap (`a0b14fa`) — the receipt audits itself:** a
reconciliation tier now runs after every parse, built on the fact that
a receipt is a ledger with redundant data:

- every harvested count is verified against its own line
  (count × unit price = line price), and whichever half the arithmetic
  disproves gets repaired by division
- items still missing a count get a targeted re-OCR of the strip of
  paper where their qty line physically sits (found by box geometry),
  and only the price token is trusted — the count comes from dividing
  the already-read line price, accepted only when it lands on a clean
  integer
- the parse then reconciles globally: unit counts must sum to the
  printed "Items in Transaction: N", line prices must sum to the
  printed total; the review screen badge says "reconciled ✓" or,
  honestly, "21/24 units"

**Result on the Trip 001 photo, twice, identical: 14/14 items, 4/4
quantities, 24/24 units, $69.36/$69.36 — fully reconciled.** The
yogurt count that survived 23 preprocessing variants (top-of-receipt
curl; the crop OCR literally read "RATYAY we eae 0" until the band
slice was tightened and shrunk — a sliver of the row above poisons a
single-line read) came back as `4 @ $1.19` via the division path. No
reshoot required — which is the point: users will never shoot pristine
flat receipts, so the parser now leans on the receipt's own arithmetic
instead of photo quality.

**And the last raw-caps names fell:** NAME_MAP grew editorial entries
(Beef Jerky (Original Flavor), Espresso, Lettuce (Iceberg), Bananas
(Organic), Mango Soft & Juicy Snack) and unmapped names now fall
through to a formulaic `prettifyName` — Title Case, unit-noise tokens
dropped (EACH, 2 LB), known modifiers lifted into parens (ORG →
(Organic), SEEDLESS → (Seedless)). Sourdough Bread, Lite String
Cheese, and Grapes Red (Seedless) come out of the formula with no
dictionary entry at all. Full scan: 14/14, every name human-readable,
categories all correct.

**How the method was found — OCR preprocessing matrix, round 1:**
14 variants against the Trip 001 receipt (ground truth 14 items, 4 qty
lines; raw OCR was losing 3 qty lines to double-height absorbed boxes).
Grayscale/contrast stretch, CLAHE, Otsu, median denoise, deskew, 2x
upscale, and Tesseract PSM modes 4/6/11, solo + combos, each scored
items/14, qty/4, garbage. Findings:

- **PSM 6 (single uniform block) is the only variant that found 14/14
  items with zero garbage.** Segmentation mode mattered more than any
  pixel treatment — as predicted by the absorbed-box overlay.
- **up2 + contrast stretch + PSM 4 recovered 2 of the 3 absorbed qty
  lines (jerky, mango)** and they flowed through the existing
  quantity-harvest logic unmodified — proof the parser needs zero
  changes when segmentation improves. Cost: 2 items dropped, banana's
  qty line lost.
- 2x upscale alone (PSM 3) is catastrophic: 0/14 items on every
  upscale-without-PSM4 variant. CLAHE and PSM 11 also scored 0/14.
- Round 1 verdict: no single variant won both contests — which set up
  round 2.

**Round 2 (PSM6 combos + composites) found the unlock:** 2x upscale is
only catastrophic under auto-segmentation; under PSM 6 it's the win —
up2+stretch+PSM6 scored 14/14 items, 3/4 qty, 0 garbage in a single
~7s pass. It beat both two-pass composites on data quality: the
merge composite grafted mango a mangled unit price ($882.49), and
per-line crop-zoom re-OCR merged "@" into count digits (4 @ → 18).
PSM 6 repeat runs scored identically. Yogurt's "4 @ $1.19" survived
all 23 variants unrecovered — it lives in the top-of-receipt curl, same
region that mangles the name line. The photo, not the code, is that
ceiling.

**Also learned:** feeding Tesseract a canvas re-encode of the same
photo scores slightly differently than the file itself (baseline
13/14 vs the file's 14/14) — one more data point on OCR sensitivity.

Tester feedback batch: quantity lines, junk sub-lines, dirty names.

**Shipped (parseReceipt rewrite, `938520e`):**
- Quantity lines ("4 @ $1.19") are now harvested, not filtered: the count
  attaches as qty to the item above. The tolerant pattern handles OCR
  mangling — tonight's live run read the banana line as "6 8 $0.29"
  (@ became an 8) and it still landed as `qty=6 @ $0.29`. This replaces
  the Day 7 ghost filter with real logic.
- Detected-item meta now shows the count where the count belongs; the
  line price moved to its own `price` field.
- Price-ending sub-lines (REGULAR PRICE, RETURN VALUE, SALE PRICE…) are
  filtered — they end in a price, which used to be the only thing the
  parser checked, so they parsed as items.
- Names lose leading register index digits and a trailing dept code
  ("1 NICE TWIST… A" → "NICE TWIST…").

**Verified:** TJ receipt 14/14 before → 14/14 after, zero regressions,
banana qty harvested. Walgreens patterns verified against a synthetic
fixture (8 items incl. 3 junk → 4 clean) — **the tester's actual
Walgreens image never made it to disk, so the real-image run is still
owed.** Before/after item lists captured from the console for both.

**Shipped (dictionary tier, `0667021`):** NAME_MAP (abbrev → real name)
+ CATEGORY_HINTS (keyword → category), wired in as `expandName` /
`guessCategory`. Seeded strictly from tonight's actual console strings:
"ER OKYR CHERRY 5 3 0" now resolves to Cherry Yogurt / Dairy; six names
resolve, 12 of 14 items auto-categorize off the Pantry default.

**Shipped (installability, `6ad9338`):** manifest.json + 192/512 icons +
apple-touch-icon, theme color from the app green. Deliberately **no
service worker** — daily builds + cache-first = stale testers. Manifest
validated and all assets fetch 200 locally; install-on-device check
needs the app on HTTPS hosting first.

**Known limits, logged:**
- OCR nondeterminism confirmed again: only 1 of the receipt's 4 quantity
  lines survived OCR tonight (banana). The harvest logic is exercised;
  the OCR miss rate is the ceiling. "Best of N reads" stays on the
  parking lot.
- NAME_MAP is TJ-seeded only. Walgreens entries wait for real output
  from the real image.

## Day 7 — 2026-08-19 — The Impostor

First real-world test: my own Trader Joe's receipt, 14 known items.

**Result: 14/14 products detected.** Zero missed. One mangled name
("ER OKYR CHERRY 5 3 0" = Yogurt Skyr Cherry — top-of-receipt curl).
And one impostor: "6 8 — $0.29". That's the banana quantity line
("6 @ $0.29") — OCR read the @ as an 8, and the parser let it through
because it ends in a price, which is the only thing the parser checks.
Scammed by its own rule.

**Shipped today:**
- Ghost filter: lines whose "name" is only digits/spaces get rejected
- Reject-in-review: detected items can now be tossed before they hit
  the pantry (previously add-all-then-delete — misfit)
- Review screen confirm CTA: status chips made no sense pre-pantry;
  replaced with reject buttons + a proper "Everything look good?" confirm

**Known limits, logged:**
- Quantity lines carry real data (that "6 @ $0.29" IS the banana count) —
  currently filtered, not harvested. Next.
- Detected item meta shows price where count belongs. Same fix.
- One receipt, one store. TJ's prints friendly names — accuracy number
  is a TJ's number, not a universal one.
  
## 2026-08-17 — The parser gets gated, then the pipeline goes real

**The confession first:** Yesterday's devlog originally claimed the parser shipped. It hadn't — the function was still sitting in my planning doc. Caught it this morning running my own verification check before starting new work, corrected the log (see previous commit), and adopted the rule permanently: **claims get verified in the console, not the plan.**

**Then made it true — M2 shipped and gated:** Pasted the parser in, ran it against the kebab receipt's OCR text, and the output matched the prediction made two days ago exactly:

- `Chicken Kebab Plate — 21.95` ✓
- `Bottled Soft Drink — 3.95` ✓
- Cola: correctly dropped (modifier line, no price)
- Address, phone, Ticket #: correctly dropped (no price pattern)
- Subtotal / Sales Tax / Total / US DEBIT: correctly killed by the junk filter

Every line of the receipt went exactly where the design said it would. Prediction → gate → verified → *then* claimed. In that order this time.

**M3 shipped — photo to pantry, end to end:** The scan handler now runs the real chain: recognize → parse → guard (empty result gets "try a clearer photo" instead of a silent nothing) → detected items render for review → Add pushes them into the pantry → persistence keeps them there. The hardcoded "3 found" is now a real count, and the three fake seed items (Spinach, Coffee, Orange Juice — the ones that "detected" on every photo since the prototype) are deleted. The fake pipeline is the real pipeline. The review-before-add screen my team designed for mock data turned out to be exactly the right shape for real, imperfect OCR — the human is the error correction.

**Bug of the day — the one worth studying:** First draft of the new handler had the guard inverted: `if (items.length)` instead of `if (!items.length)`. That bug fails *silently in both directions* — successful parses would announce "No items found" and bail; empty parses would sail through and render nothing. No error, no crash, just an app that lies. Caught in review before it ever ran. Inverted guards are the bug class that survives to production; this one didn't get the chance.

**Spelling curse, victim #4:** `rendeerUpload`. The chapter's bug ledger now reads: four bugs, four single-character-or-single-word typos, zero logic errors that shipped. (The inverted guard would have been the first — review caught it.)

**Also learned (from yesterday, confirmed today): OCR is nondeterministic.** Same photo, same code, different text run to run — the engine's segmentation makes probabilistic layout calls before reading a single character. Third run on the same image today came back clean again, but the variance is real. It's another argument for the review screen, and it put "best of N reads" on the parking lot.

**State of the app:** A photographed receipt becomes reviewed, approved, persistent pantry items — fully client-side, no server, no accounts, receipt never leaves the device. The core loop the prototype faked is now just... how it works.

**Next:** Teaching the app what cryptic receipt names actually mean, and squeezing more accuracy out of bad photos.

## 2026-08-16 — Receipt OCR: it reads for real

**Shipped:** Milestones 0–1 of the receipt chapter. A real file input with image preview (the prototype never actually accepted an image — the upload box was decorative). Tesseract.js wired in for fully in-browser OCR — no server, no API keys, the receipt never leaves the device. Raw receipt text now dumps from a photographed receipt.

**Parser design (not yet in the app):** Prices are the anchor. Receipt OCR mangles words but digits survive, so the plan: keep only lines ending in a price pattern, strip the price, treat whatever's in front of it as the item name. Junk lines (TOTAL, TAX, VISA, etc.) filtered by keyword. Whatever garbage remains gets absorbed by the existing review-before-add screen — the prototype's fake "detected items" flow turns out to be exactly the right architecture for real, imperfect OCR.

**The experiment:** Bought dinner and got two copies of the same receipt — kept one flat, crumpled the other on purpose. Same content, one variable.
- Flat + cropped: near-verbatim read. Every item, every price, exact.
- Crumpled: "ChickKsrrKebabPlate rss | $21.85" — recognizable soup, wrong price.
- Bonus worst case (crumpled REI return receipt from my backpack): pure soup, but prices still surfaced.

**Lesson:** The photo matters more than the code. Image quality dominates OCR accuracy — flatten the receipt, shoot straight-on, good light. Image preprocessing (contrast, grayscale) is on the parking lot for squeezing more out of bad photos, but user guidance ("lay it flat") is the cheaper 80%.

**Bug count: two today, single-character both.** `Tessaract` (should be Tesseract) and `$("$scanStatus")` (dollar sign where the # goes — invalid selector). Chapter total including `structredClone`: three bugs, three typos.

**Next:** The parser goes from plan to code, then parsed items wire into the detected-items flow — photo to pantry, end to end.

**Bug count: three. All three were a single wrong character.** `structredClone` (missing u — killed the whole app on load), `Tessaract` (should be Tesseract), and `$("$scanStatus")` (dollar sign where the # goes — invalid selector). 100% of this chapter's bugs so far: spelling.

**Next:** Wire parsed items into the detected-items flow so a photographed receipt lands in the pantry — then the fake pipeline is fully real, end to end.

## 2026-08-15 — Persistence (localStorage)

**Shipped:** Pantry, grocery list, and suggestions now survive page refresh and browser restarts. Added a reset button (↺) that restores the demo seed data.

**Problem it addressed:** The prototype kept all state in a single in-memory object. Switching between the app's views *looked* like persistence (the page never reloads — views are just shown/hidden sections), but a refresh threw away the page's memory and re-ran the seed data. Anything you added was gone.

**How it works:**
- The old `state` literal became `defaultState`; the live state is built by `loadState()`, which merges any saved data from localStorage over a fresh clone of the defaults
- `saveState()` serializes only the *durable* slices (pantry, groceryList, suggestions) and is called after every mutation — add, delete, status cycle, list changes
- UI state (current view, search text, filters, the fake "scanned" flag) is deliberately **not** persisted, so the app always opens fresh on Home
- Reset = remove the storage key + reload; the seed data comes back untouched thanks to `structuredClone` on the defaults
- A try/catch around the load means a corrupted save falls back to demo data instead of a dead app

**What broke along the way:** Typo'd `structuredClone` as `structredClone` — which, since it runs first thing on load, threw a ReferenceError and killed the entire script before anything rendered. One missing letter, fully dead app. Console had the answer immediately.

**Lesson:** In-memory "it works when I click around" is not persistence — the refresh test is the only test. And design decisions about what *not* to persist matter as much as what to save.

**Next:** Real receipt OCR — replace the hardcoded "detected items" with actual text extraction from an uploaded photo.

