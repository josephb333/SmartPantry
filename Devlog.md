# SmartPantry Devlog

Working notes from taking this from class prototype to real product. Newest first. Format per entry: what shipped, what problem it addressed, what broke along the way, what I learned.

---

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

## 2026-08-16 — Receipt OCR: it reads for real

**Shipped:** Real receipt scanning, milestones 0–2 of the receipt chapter. A real file input with image preview (the prototype never actually accepted an image — the upload box was decorative). Tesseract.js wired in for fully in-browser OCR — no server, no API keys, the receipt never leaves the device. A first-pass parser that turns raw OCR text into candidate pantry items.

**How the parser works:** Prices are the anchor. Receipt OCR mangles words but digits survive, so the parser keeps only lines ending in a price pattern, strips the price, and treats whatever's in front of it as the item name. Junk lines (TOTAL, TAX, VISA, etc.) are filtered by keyword. Whatever garbage remains gets absorbed by the existing review-before-add screen — the prototype's fake "detected items" flow turned out to be exactly the right architecture for real, imperfect OCR.

**The experiment:** Bought dinner and got two copies of the same receipt — kept one flat, crumpled the other on purpose. Same content, one variable.
- Flat + cropped: near-verbatim read. Every item, every price, exact.
- Crumpled: "ChickKsrrKebabPlate rss | $21.85" — recognizable soup, wrong price.
- Bonus worst case (crumpled REI return receipt from my backpack): pure soup, but prices still surfaced.

**Lesson:** The photo matters more than the code. Image quality dominates OCR accuracy — flatten the receipt, shoot straight-on, good light. Image preprocessing (contrast, grayscale) is on the parking lot for squeezing more out of bad photos, but user guidance ("lay it flat") is the cheaper 80%.

**Known correct-for-now miss:** modifier lines ("Cola" under "Bottled Soft Drink") have no price of their own, so the parser drops them. Receipts have hierarchy a line-parser can't see. Logged for later.

**Bug count: three. All three were a single wrong character.** `structredClone` (missing u — killed the whole app on load), `Tessaract` (should be Tesseract), and `$("$scanStatus")` (dollar sign where the # goes — invalid selector). 100% of this chapter's bugs so far: spelling.

**Next:** Wire parsed items into the detected-items flow so a photographed receipt lands in the pantry — then the fake pipeline is fully real, end to end.