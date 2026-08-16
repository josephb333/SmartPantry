# SmartPantry Devlog

Working notes from taking this from class prototype to real product. Newest first. Format per entry: what shipped, what problem it addressed, what broke along the way, what I learned.

---

## 2026-08-18 — Persistence (localStorage)

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