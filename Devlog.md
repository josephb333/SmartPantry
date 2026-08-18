# SmartPantry Devlog

Working notes from taking this from class prototype to real product. Newest first. Format per entry: what shipped, what problem it addressed, what broke along the way, what I learned.

---

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

