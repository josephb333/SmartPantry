const defaultState = {
  view: "home",
  category: "All",
  tagFilter: null,
  search: "",
  scanned: false,
  pantry: [],
  groceryList: [],
  suggestions: [], // derived each render, never persisted
  detected: [],
  editingId: null,     // detected row with its editor open
  addingItem: false,   // missed-item form open on the reveal screen
  receiptMeta: null,   // {purchasedAt, tripId} of the scan under review
  reconciliation: null // live ledger report — recomputed after every edit
};

const STORAGE_KEY = "smartpantry";

function loadState() {
  const fresh = structuredClone(defaultState);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      fresh.pantry = saved.pantry ?? fresh.pantry;
      fresh.groceryList = saved.groceryList ?? fresh.groceryList;
    }
  } catch (e) { /* corrupted data, fall back to defaults */ }
  return fresh;
}

const state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    pantry: state.pantry,
    groceryList: state.groceryList
  }));
}

function resetState() {
  [STORAGE_KEY, EVENT_LOG_KEY, ADJUST_LOG_KEY, HISTORY_KEY, DISMISS_KEY, SUGGEST_LOG_KEY, CORRECTION_LOG_KEY]
    .forEach((key) => localStorage.removeItem(key));
  location.reload();
}

// append-only reveal-screen correction log — user fixes to the parse are
// labeled examples, same pattern as the pantry adjustment log
function logCorrection(type, before, after) {
  const log = readList(CORRECTION_LOG_KEY);
  log.push({ type, before, after, ts: new Date().toISOString(), tripId: state.receiptMeta ? state.receiptMeta.tripId : null });
  writeStore(CORRECTION_LOG_KEY, log);
  console.log(`correction [${type}]:`, before, "->", after, `(${log.length} events)`);
}

const EVENT_LOG_KEY = "smartpantry_events";
const ADJUST_LOG_KEY = "smartpantry_adjustments";
const HISTORY_KEY = "smartpantry_history";
const DISMISS_KEY = "smartpantry_dismissed";
const SUGGEST_LOG_KEY = "smartpantry_suggestion_log";
const CORRECTION_LOG_KEY = "smartpantry_corrections";

const readStore = (key) => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } };
const readList = (key) => { try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const writeStore = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage must never break the app */ } };

// append-only +/- tap history; no UI reads it yet
function logAdjustment(item, delta) {
  try {
    const log = JSON.parse(localStorage.getItem(ADJUST_LOG_KEY)) || [];
    log.push({ item, delta, timestamp: new Date().toISOString() });
    localStorage.setItem(ADJUST_LOG_KEY, JSON.stringify(log));
  } catch (e) { /* the log must never break the app */ }
}

// pantry qty strings keep their descriptor ("4 @ $1.19", "12 count") — the
// leading integer is the adjustable count; a string without one counts as 1
const qtyCount = (item) => {
  const m = String(item.qty).match(/^\d+/);
  return m ? Number(m[0]) : 1;
};

function adjustQty(item, delta) {
  const next = qtyCount(item) + delta;
  if (next <= 0) {
    state.pantry = state.pantry.filter((p) => p.id !== item.id);
    state.groceryList = [];
  } else {
    item.qty = /^\d+/.test(String(item.qty))
      ? String(item.qty).replace(/^\d+/, String(next))
      : String(next);
  }
  logAdjustment(item.name, delta);
  saveState();
  render();
}

// append-only purchase/consumption history; no UI reads it yet
function logEvent(type, item) {
  try {
    const events = JSON.parse(localStorage.getItem(EVENT_LOG_KEY)) || [];
    events.push({
      name: item.name,
      category: item.category || null,
      qty: item.qty || null,
      price: item.price || null,
      timestamp: new Date().toISOString(),
      type
    });
    localStorage.setItem(EVENT_LOG_KEY, JSON.stringify(events));
  } catch (e) { /* the log must never break the app */ }
}

const pageTitles = {
  home: "Home",
  upload: "Upload Receipt",
  pantry: "My Pantry",
  list: "Grocery List"
};

// tag taxonomy — the interface between the learning system and the user.
// Three actionable states render as homescreen prompts whose accept/dismiss
// answers feed the suggestion log; three quiet context states live only on
// pantry rows. A healthy item carries no tag at all.
const TAG_DEF = {
  expired: { label: "Expired", cls: "urgent", actionable: true },
  expiring: { label: "Expiring", cls: "soon", actionable: true },
  low: { label: "Low", cls: "low", actionable: true },
  staple: { label: "Staple", cls: "staple" },
  priceUp: { label: "Price ↑", cls: "price-up" },
  noData: { label: "No shelf data", cls: "muted" }
};

const DAY_MS = 86400000;

// QA-only time source: tags and cadence math read the clock through nowMs so
// the debug harness can move "today" without touching stored data
let todayOverride = null;
const nowMs = () => (todayOverride ? todayOverride.getTime() : Date.now());

function tagsFor(item) {
  const tags = [];
  if (item.shelf && item.shelf.expiresAt) {
    const rem = Math.ceil((new Date(item.shelf.expiresAt) - nowMs()) / DAY_MS);
    // expiring window: 20% of the estimated span or 2 days, whichever is longer
    const windowDays = Math.max(2, Math.round(item.shelf.midDays * 0.2));
    if (rem < 0) tags.push({ key: "expired", reason: `est. expired ${-rem}d ago` });
    else if (rem <= windowDays) tags.push({ key: "expiring", reason: rem === 0 ? "est. expires today" : `est. ~${rem}d left` });
  } else {
    tags.push({ key: "noData", reason: "no shelf-life match — estimate unavailable" });
  }
  const learn = learningFor(nameStem(item.name));
  if (learn.trips >= 2) {
    // learning tier renders only on repeat evidence (>= 2 trips)
    if (learn.low) tags.push({ key: "low", reason: `bought every ~${learn.cadence}d, last ${learn.daysSince}d ago` });
    if (learn.staple) tags.push({ key: "staple", reason: `on ${learn.trips} of your trips` });
    if (learn.priceUp) tags.push({ key: "priceUp", reason: `$${learn.prevUnit.toFixed(2)} → $${learn.lastUnit.toFixed(2)} per unit` });
  }
  return tags;
}

const tagPills = (tags) => tags
  .map((t) => `<span class="status-pill ${TAG_DEF[t.key].cls}" title="${t.reason || ""}">${TAG_DEF[t.key].label}</span>`)
  .join(" ");

const fmtDay = (iso) => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setView(view) {
  state.view = view;
  $("#pageTitle").textContent = pageTitles[view];
  $$(".view").forEach((section) => section.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  $$(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  render();
}

// tone is a status-pill class: stocked (green), soon (yellow), urgent (red)
function setScanStatus(text, tone) {
  const pill = $("#scanStatus");
  pill.textContent = text;
  pill.className = `status-pill ${tone}`;
}

function renderItemRow(item, options = {}) {
  const check = options.checkbox
    ? `<input class="form-check-input" type="checkbox" ${item.done ? "checked" : ""} data-toggle-list="${item.id}">`
    : options.pantryActions
      ? `<div class="qty-adjust">
          <button class="qty-btn" type="button" data-qty-adjust="${item.id}" data-delta="-1" aria-label="Decrease quantity">−</button>
          <button class="qty-btn" type="button" data-qty-adjust="${item.id}" data-delta="1" aria-label="Increase quantity">+</button>
        </div>`
      : `<span aria-hidden="true">${options.dot || ""}</span>`;
  const actions = options.pantryActions
    ? `<div class="row-actions">
        <button class="mini-button" type="button" data-delete-item="${item.id}">All done</button>
      </div>`
    : options.removable
      ? `<button class="mini-button remove-button" type="button" data-remove-list="${item.id}" aria-label="Remove from list">×</button>`
      : `<span aria-hidden="true"></span>`;
  const tagsHtml = options.tags && options.tags.length
    ? `<div class="tag-row">${tagPills(options.tags)}</div>`
    : "";

  return `
    <div class="item-row ${item.done ? "done" : ""}">
      ${check}
      <div>
        <div class="item-name">${item.name}</div>
        <div class="item-meta">${options.meta ?? (item.qty || item.reason || item.category || "")}</div>
        ${tagsHtml}
      </div>
      ${actions}
    </div>
  `;
}

// a prompt stays answered (either way) until the item is bought again
function promptDismissed(item, tagKey, dismissed) {
  const d = dismissed[`${nameStem(item.name)}|${tagKey}`];
  return d && (!item.purchasedAt || d >= item.purchasedAt);
}

function renderHome() {
  const tagged = state.pantry.map((item) => ({ item, tags: tagsFor(item) }));
  const countOf = (key) => tagged.filter(({ tags }) => tags.some((t) => t.key === key)).length;
  $("#expiredCount").textContent = countOf("expired");
  $("#expiringCount").textContent = countOf("expiring");
  $("#lowCount").textContent = countOf("low");

  const dismissed = readStore(DISMISS_KEY);
  const attention = [];
  for (const { item, tags } of tagged) {
    for (const tag of tags) {
      if (!TAG_DEF[tag.key].actionable) continue;
      if (promptDismissed(item, tag.key, dismissed)) continue;
      attention.push({ item, tag });
    }
  }
  $("#attentionViewAll").style.display = attention.length ? "" : "none";
  $("#attentionItems").innerHTML = attention.length
    ? attention.slice(0, 6).map(({ item, tag }) => `
        <div class="item-row">
          <span>${tagPills([tag])}</span>
          <div>
            <div class="item-name">${item.name}</div>
            <div class="item-meta">${tag.reason || ""}</div>
          </div>
          <div class="row-actions">
            <button class="mini-button" type="button" data-suggest-add="${item.id}" data-tag="${tag.key}">+ List</button>
            <button class="mini-button remove-button" type="button" data-suggest-dismiss="${item.id}" data-tag="${tag.key}" aria-label="Dismiss">×</button>
          </div>
        </div>
      `).join("")
    : `<div class="all-clear gray-box">
        <p class="all-clear-title">All clear.</p>
        <p class="all-clear-sub">Nothing needs your attention.</p>
      </div>`;
}

function renderPantry() {
  const hasItems = state.pantry.length > 0;
  $("#pantrySearch").style.display = hasItems ? "" : "none";
  $("#pantryFilters").style.display = hasItems ? "" : "none";
  if (!hasItems) {
    $("#pantryItems").innerHTML = `
      <div class="empty-state gray-box">
        <p class="empty-title">Your pantry is empty.</p>
        <p class="empty-sub">Scan a receipt and it stocks itself.</p>
        <button class="primary-action compact" type="button" data-view="upload">Scan a receipt</button>
      </div>`;
    return;
  }
  const query = state.search.trim().toLowerCase();
  const tagged = state.pantry.map((item) => ({ item, tags: tagsFor(item) }));
  const visible = tagged.filter(({ item, tags }) => {
    const matchesCategory = state.category === "All" || item.category === state.category;
    const matchesTag = !state.tagFilter || tags.some((t) => t.key === state.tagFilter);
    const matchesSearch = !query || item.name.toLowerCase().includes(query);
    return matchesCategory && matchesTag && matchesSearch;
  });
  const groups = [...new Set(visible.map(({ item }) => item.category))];
  const groupHtml = groups.map((category) => `
    <section>
      <h3 class="category-title">${category}</h3>
      ${visible.filter(({ item }) => item.category === category).map(({ item, tags }) => renderItemRow(item, {
        pantryActions: true,
        tags,
        meta: [item.qty, item.shelf ? `est. ${item.shelf.loc} life to ${fmtDay(item.shelf.expiresAt)}` : ""].filter(Boolean).join(" · ")
      })).join("")}
    </section>
  `).join("") || `<p class="text-secondary">No matching pantry items.</p>`;
  $("#pantryItems").innerHTML = `<p class="whisper">+ / − to adjust by hand. The pantry keeps count.</p>` + groupHtml;
}

// pathway 2 — explicit generation: every unanswered actionable tag (expired /
// expiring / low) proposes a row. Stems already on the list, or whose prompt
// was already answered since the last purchase, are skipped. Passive tags
// never generate rows.
function generateListFromPantry() {
  const dismissed = readStore(DISMISS_KEY);
  const listed = new Set(state.groceryList.map((g) => nameStem(g.name)));
  let added = 0;
  for (const item of state.pantry) {
    const s = nameStem(item.name);
    if (listed.has(s)) continue;
    const actionable = tagsFor(item).filter((t) => TAG_DEF[t.key].actionable
      && !promptDismissed(item, t.key, dismissed));
    if (!actionable.length) continue;
    listed.add(s);
    state.groceryList.push({
      id: Date.now() + Math.random(),
      name: item.name,
      qty: "",
      done: false,
      reason: actionable[0].reason,
      generatedTag: actionable[0].key
    });
    logSuggestion(item.name, actionable[0].key, "generated");
    added++;
  }
  saveState();
  renderGroceryList();
  toast(added ? `${added} item${added === 1 ? "" : "s"} added from your pantry` : "Nothing needs restocking right now");
}

// quiet-tier suggestions: staples not already on the list
function deriveSuggestions() {
  const listed = new Set(state.groceryList.map((g) => nameStem(g.name)));
  const out = [];
  for (const item of state.pantry) {
    const s = nameStem(item.name);
    if (listed.has(s) || out.some((x) => nameStem(x.name) === s)) continue;
    const learn = learningFor(s);
    if (learn.trips >= 2 && learn.staple) out.push({ id: `staple-${s}`, name: item.name, reason: `Staple — on ${learn.trips} of your trips` });
  }
  return out;
}

function renderGroceryList() {
  state.suggestions = deriveSuggestions();
  $("#groceryItems").innerHTML = state.groceryList.map((item) => renderItemRow(item, { checkbox: true, removable: true, meta: item.reason || item.qty || "" })).join("");
  $("#listExplainer").style.display = state.groceryList.length ? "none" : "";
  $("#createListBtn").style.display = state.groceryList.length ? "" : "none";
  $("#suggestedSection").style.display = state.suggestions.length ? "" : "none";
  $("#suggestedItems").innerHTML = state.suggestions.map((item) => `
    <div class="item-row">
      <span></span>
      <div>
        <div class="item-name">${item.name}</div>
        <div class="item-meta">${item.reason}</div>
      </div>
      <button class="mini-button" type="button" data-add-suggestion="${item.id}">Add</button>
    </div>
  `).join("");
}

function badgeFor(recon) {
  if (!recon) return "";
  if (recon.reconciled) return " · reconciled ✓";
  if (recon.unitsPrinted != null && !recon.unitsMatch) return ` · ${recon.unitsCounted}/${recon.unitsPrinted} units`;
  if (recon.unitsMatch) return " · units ✓";
  if (recon.totalMatch) return " · total ✓";
  return "";
}

// live checksum: every edit on the reveal screen re-proves the ledger in
// place — an edit that lands the sum flips the badge to reconciled ✓
function refreshLedger() {
  if (state.reconciliation) summarizeLedger(state.reconciliation, state.detected);
}

// what the printed total (minus tax) says is still missing from the items
function ledgerResidual() {
  const r = state.reconciliation;
  if (!r || !r.totalPrinted || !r.totalPrinted.length) return null;
  const freq = {};
  r.totalPrinted.forEach((t) => { freq[t] = (freq[t] || 0) + 1; });
  const grand = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
  return +(grand - (r.taxPrinted || 0) - r.pricesSum).toFixed(2);
}

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const APP_CATEGORIES = ["Produce", "Dairy", "Protein", "Bakery", "Frozen", "Breakfast",
  "Snacks", "Beverages", "Pantry", "Household", "Personal Care"];

// shelf dropdown: the auto match with every storage span it offers, the
// runner-up matches, and an explicit no-estimate
function shelfOptionsHtml(item) {
  const cands = rankShelfCandidates([item.rawName, item.name], item.category, 4);
  const opts = [];
  cands.forEach((entry, i) => {
    ["fridge", "pantry", "freezer"].forEach((loc) => {
      if (!entry[loc]) return;
      if (i > 0 && loc !== defaultLocOf(entry)) return;
      const mid = Math.round((entry[loc][0] + entry[loc][1]) / 2);
      const sel = item.shelf && item.shelf.match === entry.name && item.shelf.loc === loc ? "selected" : "";
      opts.push(`<option value="${i}|${loc}" ${sel}>${escAttr(entry.name)} — ${loc}, ~${mid}d</option>`);
    });
  });
  opts.push(`<option value="none" ${item.shelf ? "" : "selected"}>No shelf estimate</option>`);
  return opts.join("");
}

function detectedRowHtml(item) {
  const editing = state.editingId === item.id;
  const shelfLine = item.shelf
    ? `est. ${item.shelf.loc} life to ${fmtDay(item.shelf.expiresAt)}`
    : "no shelf estimate";
  const meta = [item.qty, `$${item.price}`, shelfLine].filter(Boolean).join(" · ");
  const editor = editing ? `
      <div class="detected-editor">
        <input class="form-control" value="${escAttr(item.name)}" data-name-edit="${item.id}" aria-label="Item name">
        <div class="form-grid">
          <select class="form-select" data-category-edit="${item.id}" aria-label="Category">
            ${APP_CATEGORIES.map((c) => `<option ${c === item.category ? "selected" : ""}>${c}</option>`).join("")}
          </select>
          <select class="form-select" data-shelf-edit="${item.id}" aria-label="Shelf life">
            ${shelfOptionsHtml(item)}
          </select>
        </div>
      </div>` : "";
  return `
    <div class="item-row detected-row">
      <div class="qty-adjust">
        <button class="qty-btn" type="button" data-detected-qty="${item.id}" data-delta="-1" aria-label="Decrease quantity">−</button>
        <button class="qty-btn" type="button" data-detected-qty="${item.id}" data-delta="1" aria-label="Increase quantity">+</button>
      </div>
      <div>
        <div class="item-name">${item.name}</div>
        <div class="item-meta">${meta}</div>
        ${editor}
      </div>
      <div class="row-actions">
        <button class="mini-button" type="button" data-edit-detected="${item.id}">${editing ? "Done" : "Edit"}</button>
        <button class="mini-button reject-btn" type="button" data-id="${item.id}" aria-label="Reject item">×</button>
      </div>
    </div>
  `;
}

function addMissedHtml() {
  if (!state.addingItem) {
    return `<button class="mini-button add-missed-open" type="button" data-add-missed-open>Add item</button>`;
  }
  const res = ledgerResidual();
  const prefill = res != null && res > 0.02 ? res.toFixed(2) : "";
  return `
    <form id="addMissedForm" class="add-missed">
      <input id="missedName" class="form-control" required placeholder="Item name" aria-label="Item name">
      <input id="missedQty" class="form-control" type="number" min="1" step="1" value="1" aria-label="Quantity">
      <input id="missedPrice" class="form-control" type="number" min="0" step="0.01" value="${prefill}" placeholder="0.00" aria-label="Price">
      <div class="form-actions">
        <button class="mini-button" type="submit">Add item</button>
        <button class="mini-button" type="button" data-add-missed-cancel>Cancel</button>
      </div>
    </form>
  `;
}

function renderUpload() {
  $("#detectedItems").innerHTML = state.scanned
    ? state.detected.map(detectedRowHtml).join("") + addMissedHtml()
    : `<p class="text-secondary">Process a receipt to preview extracted items.</p>`;
  if (state.scanned) {
    const r = state.reconciliation;
    let pill = `${state.detected.length} found${badgeFor(r)}`;
    const res = ledgerResidual();
    if (r && !r.reconciled && res != null && Math.abs(res) > 0.02) {
      pill += res > 0 ? ` · $${res.toFixed(2)} unaccounted` : ` · $${(-res).toFixed(2)} over`;
    }
    setScanStatus(pill, !r || r.reconciled ? "stocked" : "soon");
  } else {
    setScanStatus("Ready", "stocked");
  }
  const addBtn = $("#addDetectedBtn");
  const showConfirm = state.scanned && state.detected.length > 0;
  addBtn.style.display = showConfirm ? "" : "none";
  addBtn.disabled = !showConfirm;
  addBtn.classList.toggle("ready", showConfirm);
}

function render() {
  historyMemo = null; // learning reads fresh data once per render cycle
  renderHome();
  renderPantry();
  renderGroceryList();
  renderUpload();
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 1800);
}

// abbrev → real name; keys are actual OCR output strings from real runs
const NAME_MAP = {
  "ER OKYR CHERRY": "Cherry Yogurt",
  "YOGURT SKYR CHERRY": "Cherry Yogurt",
  "VEGGIE STICKS POTATO SNA": "Veggie Sticks Potato Snacks",
  "BEEF JERKY ORIGINAL": "Beef Jerky (Original Flavor)",
  "COFFEE ESPRESSO RTD": "Espresso",
  "SLICED TURKEY BREAST ROA": "Sliced Turkey Breast",
  "TORTILLAS ORG SPROUTED W": "Organic Sprouted Wheat Tortillas",
  "TORTILLAS ORG SRROUTED": "Organic Sprouted Wheat Tortillas",
  "A-APPLE BAG SUGARBEE": "SugarBee Apples 2lb Bag",
  "MANGO SOFT & JUICY": "Mango Soft & Juicy Snack",
  "LETTUCE ICEBERG": "Lettuce (Iceberg)",
  "BANANA ORG": "Bananas (Organic)",
  "OATMEAL INSTANT MAPLE BR": "Instant Oatmeal Maple Brown Sugar"
};

// receipt-style tokens that aren't part of a product's name
const NOISE_TOKEN = /^(EACH|EA)$/i;
const UNIT_TOKEN = /^(LB|OZ|KG|G)S?$/i;
// modifiers that read better as a parenthetical after the name
const MODIFIER_MAP = { ORG: "Organic", ORGANIC: "Organic", SEEDLESS: "Seedless" };

// fallback normalizer for names NAME_MAP doesn't know:
// Title Case, drop unit noise ("EACH", "2 LB"), lift modifiers into parens
function prettifyName(raw) {
  const tokens = raw.split(" ");
  const kept = [], mods = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (NOISE_TOKEN.test(t)) continue;
    if (/^\d+(\.\d+)?(LB|OZ|KG|G)$/i.test(t)) continue;
    if (/^\d+(\.\d+)?$/.test(t) && i + 1 < tokens.length && UNIT_TOKEN.test(tokens[i + 1])) { i++; continue; }
    const mod = MODIFIER_MAP[t.toUpperCase()];
    if (mod) { mods.push(mod); continue; }
    kept.push(/^[0-9&%'-]+$/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  }
  const name = kept.join(" ") + (mods.length ? ` (${mods.join(", ")})` : "");
  return name.trim() || raw;
}

// first-hit-wins in insertion order — specific blocks (Frozen "ice cream",
// Snacks "sticks"/"chips", Breakfast "oatmeal") must sit above the generic
// words they contain or co-occur with (Dairy "cream", Produce "potato",
// Pantry "sugar")
const CATEGORY_HINTS = {
  "ice cream": "Frozen",
  "frozen": "Frozen",
  "pizza": "Frozen",
  "paper towel": "Household",
  "toilet": "Household",
  "detergent": "Household",
  "soap": "Household",
  "trash": "Household",
  "shampoo": "Personal Care",
  "conditioner": "Personal Care",
  "toothpaste": "Personal Care",
  "deodorant": "Personal Care",
  "lotion": "Personal Care",
  "vitamin": "Personal Care",
  "oatmeal": "Breakfast",
  "oats": "Breakfast",
  "cereal": "Breakfast",
  "pancake": "Breakfast",
  "syrup": "Breakfast",
  "granola bar": "Snacks",
  "chips": "Snacks",
  "sticks": "Snacks",
  "crackers": "Snacks",
  "pretzel": "Snacks",
  "popcorn": "Snacks",
  "cookie": "Snacks",
  "candy": "Snacks",
  "chocolate": "Snacks",
  "coffee": "Beverages",
  "espresso": "Beverages",
  "tea": "Beverages",
  "juice": "Beverages",
  "soda": "Beverages",
  "water": "Beverages",
  "drink": "Beverages",
  "kombucha": "Beverages",
  "milk": "Dairy",
  "yogurt": "Dairy",
  "cheese": "Dairy",
  "butter": "Dairy",
  "cream": "Dairy",
  "skyr": "Dairy",
  "kefir": "Dairy",
  "egg": "Dairy",
  "turkey": "Protein",
  "chicken": "Protein",
  "beef": "Protein",
  "jerky": "Protein",
  "pork": "Protein",
  "ham": "Protein",
  "bacon": "Protein",
  "fish": "Protein",
  "salmon": "Protein",
  "tuna": "Protein",
  "tofu": "Protein",
  "sausage": "Protein",
  "bread": "Bakery",
  "tortilla": "Bakery",
  "bagel": "Bakery",
  "bun": "Bakery",
  "roll": "Bakery",
  "muffin": "Bakery",
  "croissant": "Bakery",
  "apple": "Produce",
  "banana": "Produce",
  "grape": "Produce",
  "mango": "Produce",
  "lettuce": "Produce",
  "berry": "Produce",
  "orange": "Produce",
  "lemon": "Produce",
  "onion": "Produce",
  "potato": "Produce",
  "tomato": "Produce",
  "avocado": "Produce",
  "spinach": "Produce",
  "carrot": "Produce",
  "pepper": "Produce",
  "cucumber": "Produce",
  "broccoli": "Produce",
  "fruit": "Produce",
  "salad": "Produce",
  "rice": "Pantry",
  "pasta": "Pantry",
  "sauce": "Pantry",
  "soup": "Pantry",
  "beans": "Pantry",
  "flour": "Pantry",
  "sugar": "Pantry",
  "oil": "Pantry",
  "spice": "Pantry",
  "canned": "Pantry"
};

function expandName(raw) {
  const upper = raw.toUpperCase();
  for (const [abbrev, full] of Object.entries(NAME_MAP)) {
    if (upper.includes(abbrev.toUpperCase())) return full;
  }
  return prettifyName(raw);
}

function guessCategory(name) {
  for (const [keyword, category] of Object.entries(CATEGORY_HINTS)) {
    // whole words only ("oil" must not hit TOILET, "tea" must not hit STEAK),
    // with plural tolerance; "berry" also matches as a suffix (STRAWBERRY)
    const pattern = keyword === "berry"
      ? /berr(y|ies)\b/i
      : new RegExp(`\\b${keyword.replace(/s$/, "")}s?\\b`, "i");
    if (pattern.test(name)) return category;
  }
  return "Pantry";
}

// ---- shelf life: USDA FoodKeeper dataset (data/foodkeeper.json, CC0) ----
const kwStemOf = (k) => String(k).toLowerCase().replace(/s$/, "");
let foodkeeperIndex = null;

const foodkeeperReady = fetch("data/foodkeeper.json")
  .then((r) => r.json())
  .then((entries) => {
    const df = {};
    const usable = entries.filter((e) => e.name && Array.isArray(e.kw) && e.kw.length);
    const stemsOf = (e) => [...new Set(e.kw.map(kwStemOf))];
    usable.forEach((e) => stemsOf(e).forEach((s) => { df[s] = (df[s] || 0) + 1; }));
    foodkeeperIndex = {
      df,
      entries: usable.map((e) => ({
        entry: e,
        head: kwStemOf(e.kw[0]),
        kws: stemsOf(e).map((s) => ({
          s,
          re: new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i")
        }))
      }))
    };
  })
  .catch((e) => { console.warn("foodkeeper data unavailable — shelf tags will read no data:", e); });

// FoodKeeper covers food only — non-food categories never match
const NON_FOOD_CATS = new Set(["Household", "Personal Care"]);

// keyword match, precision before recall: two independent keyword hits, an
// exact head-keyword hit, or a rare keyword (document frequency <= 3).
// Anything weaker scores nothing — a wrong span is worse than "no data".
// Ties keep dataset order (stable sort), matching the original first-wins rule.
function rankShelfCandidates(names, category, n) {
  if (!foodkeeperIndex || NON_FOOD_CATS.has(category)) return [];
  const text = names.filter(Boolean).join(" | ").toLowerCase();
  const scored = [];
  for (const { entry, head, kws } of foodkeeperIndex.entries) {
    const hits = kws.filter(({ re }) => re.test(text)).map(({ s }) => s);
    if (!hits.length) continue;
    const headHit = hits.includes(head) ? 1 : 0;
    if (hits.length === 1 && !headHit && (foodkeeperIndex.df[hits[0]] || 99) > 3) continue;
    scored.push({ entry, key: [hits.length, headHit, hits.reduce((t, s) => t + s.length, 0)] });
  }
  scored.sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2]);
  return scored.slice(0, n).map((x) => x.entry);
}

const defaultLocOf = (entry) => (entry.fridge ? "fridge" : entry.pantry ? "pantry" : "freezer");

const shelfInfoFrom = (entry, loc) => {
  const [minDays, maxDays] = entry[loc];
  return { match: entry.name, loc, minDays, maxDays, midDays: Math.round((minDays + maxDays) / 2) };
};

function matchShelfLife(names, category) {
  const best = rankShelfCandidates(names, category, 1)[0];
  return best ? shelfInfoFrom(best, defaultLocOf(best)) : null;
}

// estimate: purchase date plus the midpoint of the storage span
function shelfFor(item, rawName) {
  const info = matchShelfLife([rawName, item.name], item.category);
  if (!info) return null;
  const purchased = item.purchasedAt ? new Date(item.purchasedAt) : new Date();
  return { ...info, expiresAt: new Date(purchased.getTime() + info.midDays * DAY_MS).toISOString() };
}

// the receipt names its own purchase moment: "0200 6 88161 08-26-2026 13:06"
function parseReceiptMeta(text) {
  const m = (text || "").match(/\b(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})\b/);
  if (m) {
    const mm = Number(m[1]), dd = Number(m[2]), yyyy = Number(m[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy >= 2000 && yyyy <= 2099) {
      return {
        purchasedAt: new Date(yyyy, mm - 1, dd).toISOString(),
        tripId: `${m[3]}-${m[1]}-${m[2]} ${m[4]}:${m[5]}`
      };
    }
  }
  const now = new Date();
  return { purchasedAt: now.toISOString(), tripId: `scan ${now.toISOString()}` };
}

// ---- purchase-history learning store ----
let historyMemo = null;
const getHistory = () => historyMemo || (historyMemo = readStore(HISTORY_KEY));

// one scanned receipt = one trip; rescanning the same receipt must not count
// twice, so rows dedupe on tripId per item
function recordPurchases(entries, meta) {
  const history = readStore(HISTORY_KEY);
  for (const it of entries) {
    const s = nameStem(it.name);
    const rows = history[s] || (history[s] = []);
    if (rows.some((r) => r.tripId === meta.tripId)) continue;
    const { count, unit } = itemUnit(it);
    rows.push({ date: (it.purchasedAt || meta.purchasedAt).slice(0, 10), qty: count, unit: +unit.toFixed(2), tripId: meta.tripId });
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  writeStore(HISTORY_KEY, history);
  historyMemo = null;
  return history;
}

function learningFor(stemKey) {
  const rows = getHistory()[stemKey] || [];
  const trips = new Set(rows.map((r) => r.tripId)).size;
  if (trips < 2) return { trips };
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / DAY_MS));
  gaps.sort((a, b) => a - b);
  const cadence = Math.max(1, gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1);
  const daysSince = Math.floor((nowMs() - new Date(dates[dates.length - 1])) / DAY_MS);
  const last = rows[rows.length - 1], prev = rows[rows.length - 2];
  return {
    trips,
    cadence,
    daysSince,
    low: daysSince >= cadence,
    staple: trips >= 3,
    priceUp: prev != null && last.unit > prev.unit + 0.009,
    lastUnit: last.unit,
    prevUnit: prev ? prev.unit : null
  };
}

function markPromptAnswered(item, tagKey) {
  const dismissed = readStore(DISMISS_KEY);
  dismissed[`${nameStem(item.name)}|${tagKey}`] = new Date().toISOString();
  writeStore(DISMISS_KEY, dismissed);
}

// append-only reinforcement log: every answered prompt is a labeled example
function logSuggestion(name, tag, action) {
  const log = readList(SUGGEST_LOG_KEY);
  log.push({ name, tag, action, at: new Date().toISOString() });
  writeStore(SUGGEST_LOG_KEY, log);
  console.log(`suggestion ${action}: ${name} [${tag}] — logged (${log.length} events total)`);
}

// OTAL not TOTAL: thermal-paper T degrades into f/F ("fOTAL PURCHASE") —
// SUBTOTAL still matches through its OTAL. Payment-footer words (PURCHASE,
// MID/TID, AUTH, CARDHOLDER, MOBILE) keep mangled card lines out of the items.
const JUNK = /OTAL|TAX|CHANGE|DEBIT|CREDIT|VISA|MASTERCARD|CASH|BALANCE|SAVINGS|COUPON|THANK|PURCHASE|CARDHOLDER|\bMID\b|\bTID\b|\bAUTH\b|\bMOBILE\b/i;
// price-ending sub-lines that describe the item above them, not a product
const SUB_LINE_JUNK = /(REGULAR|SALE|ORIG(?:INAL)?)\s+PRICE|RETURN\s+VALUE|PRICE\s+YOU\s+PAY|MEMBER\s+(SAV|PRICE)/i;
// count line under an item: "4 @ $1.19" — OCR often mangles the @ (8, e, —),
// so accept: small int, any non-letter junk, then a price, and nothing else
const QTY_LINE = /^(\d{1,3})\b[^A-Za-z]*?(\d+[.,]\d{2})\s*$/;

function parseReceipt(text) {
  const items = [];
  const tableRows = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length <= 2 || JUNK.test(line)) continue;

    const qtyMatch = line.match(QTY_LINE);
    if (qtyMatch) {
      const prev = items[items.length - 1];
      if (prev) prev.qty = `${qtyMatch[1]} @ $${qtyMatch[2].replace(",", ".")}`;
      continue;
    }

    const priceMatch = line.match(/(\d+[.,]\d{2})\s*[A-Z]?\s*$/);
    if (!priceMatch) continue;
    if (SUB_LINE_JUNK.test(line)) continue;
    const name = line.slice(0, priceMatch.index)
      .replace(/[^A-Za-z0-9 %&'-]/g, " ").replace(/\s+/g, " ").trim()
      .replace(/^\d+\s+/, "")   // leading register index digits
      .replace(/\s+A$/, "");    // trailing register dept code glued onto the name
    if (name.length < 2) continue;
    const cleanName = expandName(name);
    const category = guessCategory(cleanName);
    tableRows.push({ raw: name, expanded: cleanName, category });
    items.push({
      id: Date.now() + Math.random(),
      name: cleanName,
      rawName: name,
      category,
      qty: "1",
      price: priceMatch[1].replace(",", ".")
    });
  }
  console.table(tableRows);
  return items;
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    if (viewButton.dataset.filterTag) state.tagFilter = viewButton.dataset.filterTag;
    setView(viewButton.dataset.view);
    if (viewButton.dataset.generate != null) generateListFromPantry();
  }

  const filter = event.target.closest("[data-category]");
  if (filter) {
    state.category = filter.dataset.category;
    state.tagFilter = null;
    $$(".filter-chip").forEach((button) => button.classList.toggle("active", button === filter));
    renderPantry();
  }

  const suggestAdd = event.target.closest("[data-suggest-add]");
  if (suggestAdd) {
    const item = state.pantry.find((p) => String(p.id) === suggestAdd.dataset.suggestAdd);
    if (item) {
      logSuggestion(item.name, suggestAdd.dataset.tag, "accepted");
      markPromptAnswered(item, suggestAdd.dataset.tag);
      if (!state.groceryList.some((g) => nameStem(g.name) === nameStem(item.name) && !g.done)) {
        state.groceryList.push({ id: Date.now(), name: item.name, qty: "", done: false, reason: TAG_DEF[suggestAdd.dataset.tag].label.toLowerCase() });
      }
      saveState();
      render();
      toast(`${item.name} added to list`);
    }
  }

  const suggestDismiss = event.target.closest("[data-suggest-dismiss]");
  if (suggestDismiss) {
    const item = state.pantry.find((p) => String(p.id) === suggestDismiss.dataset.suggestDismiss);
    if (item) {
      logSuggestion(item.name, suggestDismiss.dataset.tag, "dismissed");
      markPromptAnswered(item, suggestDismiss.dataset.tag);
      render();
    }
  }

  const adjust = event.target.closest("[data-qty-adjust]");
  if (adjust) {
    const item = state.pantry.find((p) => p.id === Number(adjust.dataset.qtyAdjust));
    if (item) adjustQty(item, Number(adjust.dataset.delta));
  }

  const remove = event.target.closest("[data-delete-item]");
  if (remove) {
    const done = state.pantry.find((item) => item.id === Number(remove.dataset.deleteItem));
    if (done) logEvent("consumption", done);
    state.pantry = state.pantry.filter((item) => item.id !== Number(remove.dataset.deleteItem));
    state.groceryList = [];
    saveState();
    render();
  }

  const removeList = event.target.closest("[data-remove-list]");
  if (removeList) {
    const row = state.groceryList.find((item) => String(item.id) === removeList.dataset.removeList);
    // dismissing a generated row is an answer: log it and keep the item from
    // regenerating until it is bought again
    if (row && row.generatedTag) {
      logSuggestion(row.name, row.generatedTag, "dismissed");
      markPromptAnswered(row, row.generatedTag);
    }
    state.groceryList = state.groceryList.filter((item) => String(item.id) !== removeList.dataset.removeList);
    saveState();
    renderGroceryList();
  }

  const suggestion = event.target.closest("[data-add-suggestion]");
  if (suggestion) {
    const item = state.suggestions.find((entry) => entry.id === suggestion.dataset.addSuggestion);
    if (item) {
      logSuggestion(item.name, "staple", "accepted");
      state.groceryList.push({ id: Date.now(), name: item.name, qty: "", done: false, reason: item.reason });
      saveState();
      renderGroceryList();
    }
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-toggle-list]")) return;
  const item = state.groceryList.find((entry) => String(entry.id) === event.target.dataset.toggleList);
  item.done = event.target.checked;
  saveState();
  renderGroceryList();
});

$("#searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderPantry();
});

$("#addItemForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = {
    id: Date.now(),
    name: $("#newItemName").value,
    category: $("#newItemCategory").value,
    qty: "1",
    purchasedAt: new Date().toISOString()
  };
  event.target.reset();
  try { await foodkeeperReady; } catch (e) { /* shelf stays unmatched */ }
  item.shelf = shelfFor(item, null);
  state.pantry.push(item);
  state.groceryList = [];
  saveState();
  render();
  toast("Item added to pantry");
});

$("#quickAddForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#extraItemName").value.trim();
  if (!name) return;
  state.groceryList.push({
    id: Date.now(),
    name,
    qty: "",
    done: false
  });
  event.target.reset();
  saveState();
  renderGroceryList();
});

// OCR pipeline picked by the Day 11 preprocessing matrix: 2x upscale +
// grayscale + contrast stretch + PSM 6. Upscale is capped near the proven
// ~13MP envelope — larger canvases fail on mobile Safari, and huge phone
// photos already have big glyphs.
const MAX_OCR_PIXELS = 13e6;

async function preprocessReceipt(source) {
  // source is the photo file, or the corner-corrected canvas from the
  // perspective editor — the same grayscale/stretch treatment applies to both
  const fromCanvas = Boolean(source && source.getContext);
  const img = fromCanvas ? null : new Image();
  if (!fromCanvas) img.src = URL.createObjectURL(source);
  try {
    if (!fromCanvas) {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error("could not load receipt image"));
      });
    }
    const srcW = fromCanvas ? source.width : img.naturalWidth;
    const srcH = fromCanvas ? source.height : img.naturalHeight;
    const factor = Math.max(1, Math.min(2, Math.sqrt(MAX_OCR_PIXELS / (srcW * srcH))));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(srcW * factor);
    canvas.height = Math.round(srcH * factor);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(fromCanvas ? source : img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = v;
      hist[v]++;
    }
    // percentile 2-98 contrast stretch
    const n = canvas.width * canvas.height;
    let lo = 0, hi = 255, cum = 0;
    for (let i = 0; i < 256; i++) { cum += hist[i]; if (cum >= n * 0.02) { lo = i; break; } }
    cum = 0;
    for (let i = 255; i >= 0; i--) { cum += hist[i]; if (cum >= n * 0.02) { hi = i; break; } }
    const range = Math.max(hi - lo, 1);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, Math.round((d[i] - lo) * 255 / range)));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    if (!fromCanvas) URL.revokeObjectURL(img.src);
  }
}

// must mirror parseReceipt's keep-filter exactly — used to map Tesseract's
// line boxes onto parsed items by position (guarded by a count check)
function isItemLine(t) {
  const line = (t || "").trim();
  if (line.length <= 2 || JUNK.test(line)) return false;
  if (QTY_LINE.test(line)) return false;
  const priceMatch = line.match(/(\d+[.,]\d{2})\s*[A-Z]?\s*$/);
  if (!priceMatch) return false;
  if (SUB_LINE_JUNK.test(line)) return false;
  const name = line.slice(0, priceMatch.index).replace(/[^A-Za-z0-9 %&'-]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^\d+\s+/, "").replace(/\s+A$/, "");
  return name.length >= 2;
}

const MONEY = /\d+[.,]\d{2}/g;
const parseMoney = (s) => parseFloat(s.replace(",", "."));

// digit glyphs the thermal font degrades into on real scans
const GLYPH_DIGIT = { b: 6, B: 8, l: 1, I: 1, "|": 1, o: 0, O: 0, s: 5, S: 5, z: 2, Z: 2 };

const countUnits = (items) => items.reduce((s, it) => {
  const m = String(it.qty).match(/^(\d+) @/);
  return s + (m ? Number(m[1]) : 1);
}, 0);

// the summary legs of the audit, split out so the checksum can be re-proven
// on post-collapse entries: unit counts vs printed count, price sum (with and
// without printed tax) vs printed total
function summarizeLedger(report, items) {
  report.unitsCounted = countUnits(items);
  report.unitsMatch = report.unitsPrinted != null && report.unitsCounted === report.unitsPrinted;
  const pricesSum = items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0);
  report.pricesSum = +pricesSum.toFixed(2);
  const tax = report.taxPrinted || 0;
  report.totalMatch = (report.totalPrinted || []).some((t) =>
    Math.abs(t - pricesSum) <= 0.02 || Math.abs(t - (pricesSum + tax)) <= 0.02);
  report.reconciled = report.unitsMatch && report.totalMatch;
  return report;
}

// for items still count-less, find the strip of paper where a qty line would
// live: the bottom row of an absorbed (double-height) line box, or the gap
// between the item's box and the next detected line
function findQtyBands(blocks, items) {
  const lines = [];
  (blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => lines.push(l))));
  const itemIdx = [];
  lines.forEach((l, i) => { if (isItemLine(l.text)) itemIdx.push(i); });
  if (itemIdx.length !== items.length) return []; // mapping unsafe — skip recovery
  const hs = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)] || 0;
  const bands = [];
  itemIdx.forEach((li, k) => {
    if (items[k].qty !== "1") return;
    const bb = lines[li].bbox;
    let y0, y1;
    if ((bb.y1 - bb.y0) > med * 1.45) {
      // tight slice: any sliver of the row above poisons the crop OCR
      y0 = bb.y1 - med * 0.85; y1 = bb.y1 + 4;
    } else {
      const next = lines[li + 1];
      if (!next || next.bbox.y0 - bb.y1 <= med * 0.5) return;
      y0 = bb.y1 - 4; y1 = next.bbox.y0 + 4;
    }
    bands.push({ item: items[k], x: Math.max(bb.x0 - 8, 0), y: y0, w: (bb.x1 - bb.x0) * 0.6, h: y1 - y0 });
  });
  return bands;
}

// the receipt audits itself: count x unit must equal the line price, unit
// counts must sum to "Items in Transaction: N", line prices must sum to the
// printed total. Use that redundancy to verify, repair, and recover.
async function reconcile(items, data, canvas, worker) {
  const report = { repairs: [], recovered: [] };
  const rawLines = data.text.split("\n");

  // first transaction line that actually carries a number — the receipt also
  // prints a digitless "SALE TRANSACTION" header
  let um = null;
  for (const l of rawLines) { um = l.match(/transaction\D*?(\d+)/i); if (um) break; }
  report.unitsPrinted = um ? Number(um[1]) : null;
  if (report.unitsPrinted == null) {
    // printed count read as a lookalike glyph ("Items in Transaction:b") —
    // accept a single trailing glyph; the unit-count leg still has to confirm it
    for (const l of rawLines) {
      if (!/transaction/i.test(l) || /sale|payment/i.test(l)) continue;
      const g = l.trim().match(/transaction\W*(.)$/i);
      if (g && GLYPH_DIGIT[g[1]] != null) {
        report.unitsPrinted = GLYPH_DIGIT[g[1]];
        report.repairs.push(`units printed: glyph "${g[1]}" read as ${GLYPH_DIGIT[g[1]]}`);
        break;
      }
    }
  }

  const totalCandidates = [];
  let taxPrinted = 0;
  rawLines.forEach((l) => {
    if (/SUBTOTAL/i.test(l)) return;
    if (/TAX/i.test(l)) {
      // tax rides inside the printed total: "Tax: $4.99 @ 8.625% $0.43" —
      // the last money token on the line is the amount actually charged
      const t = l.trim().match(/(\d+[.,]\d{2})$/);
      if (t) taxPrinted += parseMoney(t[1]);
      return;
    }
    if (!/OTAL|BALANCE|VISA|MASTERCARD|DEBIT|CREDIT|CASH/i.test(l)) return;
    (l.match(MONEY) || []).forEach((m) => totalCandidates.push(parseMoney(m)));
  });
  report.totalPrinted = totalCandidates.length ? totalCandidates : null;
  report.taxPrinted = +taxPrinted.toFixed(2);

  // line-level: verify each harvested count against its own line price;
  // repair whichever half (count or unit) the price arithmetic disproves
  for (const it of items) {
    const m = String(it.qty).match(/^(\d+) @ \$(\d+\.\d{2})$/);
    if (!m || !it.price) continue;
    const c = Number(m[1]), u = parseFloat(m[2]), price = parseFloat(it.price);
    if (Math.abs(c * u - price) <= 0.02) { it.qtyVerified = true; continue; }
    const n = Math.round(price / u);
    if (u >= 0.01 && n >= 1 && n <= 99 && Math.abs(price / u - n) < 0.02) {
      report.repairs.push(`${it.name}: count ${c} -> ${n} (line price / unit price)`);
      it.qty = `${n} @ $${u.toFixed(2)}`;
      it.qtyVerified = true;
      continue;
    }
    const v = price / c;
    if (c >= 1 && m[2].includes(v.toFixed(2))) {
      report.repairs.push(`${it.name}: unit $${m[2]} -> $${v.toFixed(2)} (digit noise around true unit)`);
      it.qty = `${c} @ $${v.toFixed(2)}`;
      it.qtyVerified = true;
    }
  }

  // band re-OCR: crop where a missing qty line would sit, read it as a single
  // line, keep ONLY price tokens, and let division against the trusted line
  // price propose the count — accepted only if it lands on a clean integer
  const bands = findQtyBands(data.blocks, items);
  if (bands.length) await worker.setParameters({ tessedit_pageseg_mode: "7" });
  for (const b of bands) {
    const price = parseFloat(b.item.price);
    // Tesseract wants modest line heights — the canvas is already 2x
    // upscaled, so shrink first and step up only if needed
    for (const scale of [0.6, 1, 1.5]) {
      const crop = document.createElement("canvas");
      crop.width = Math.round(b.w * scale);
      crop.height = Math.round(b.h * scale);
      const cctx = crop.getContext("2d");
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = "high";
      cctx.drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, crop.width, crop.height);
      const { data: cd } = await worker.recognize(crop);
      let hit = false;
      for (const tok of ((cd.text || "").match(MONEY) || [])) {
        const u = parseMoney(tok);
        if (u < 0.01) continue;
        const n = Math.round(price / u);
        if (n >= 2 && n <= 99 && Math.abs(price / u - n) < 0.02) {
          b.item.qty = `${n} @ $${u.toFixed(2)}`;
          b.item.qtyVerified = true;
          report.recovered.push(`${b.item.name}: ${b.item.qty} (band re-OCR @${scale}x, count from price division)`);
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
  }

  // ledger-driven repairs: printed total minus printed tax states what the
  // item lines must sum to. Try each distinct printed candidate and accept
  // only a repair that lands the sum exactly on it.
  for (const t of [...new Set(totalCandidates)]) {
    const target = +(t - taxPrinted).toFixed(2);
    const gap = +(items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0) - target).toFixed(2);
    if (gap >= 10 && Math.round(gap * 100) % 1000 === 0) {
      // one price over by leading digit noise ("$1.89" read as "61,89"):
      // stripping the gap must leave the visible tail of the misread price
      const cands = items.filter((it) => {
        if (String(it.qty) !== "1") return false;
        const fixed = +(parseFloat(it.price) - gap).toFixed(2);
        if (fixed <= 0) return false;
        const ps = String(it.price), fs = fixed.toFixed(2);
        return ps.length > fs.length && ps.endsWith(fs) && /^\d{1,2}$/.test(ps.slice(0, ps.length - fs.length));
      });
      if (cands.length === 1) {
        const it = cands[0];
        const fixed = (parseFloat(it.price) - gap).toFixed(2);
        report.repairs.push(`${it.name}: price $${it.price} -> $${fixed} (printed total disproves the leading digit)`);
        it.price = fixed;
        break;
      }
    } else if (gap <= -0.03 && gap >= -99.99 && report.unitsPrinted === countUnits(items) + 1) {
      // one unit short and one item-shaped line failed its price parse — the
      // ledger names the missing price exactly
      const orphans = rawLines.map((l) => l.trim()).filter((line) =>
        line.length > 2 && !JUNK.test(line) && !SUB_LINE_JUNK.test(line) && !QTY_LINE.test(line)
        && !/(\d+[.,]\d{2})\s*[A-Z]?\s*$/.test(line)
        && /\$\s?\d|\d[.,]\d/.test(line) && /[A-Za-z]{2}/.test(line));
      if (orphans.length === 1) {
        const rawName = orphans[0]
          .replace(/\$?\s*\d+[.,]\d+.*$/, "")
          .replace(/[^A-Za-z0-9 %&'-]/g, " ").replace(/\s+/g, " ").trim()
          .replace(/^\d+\s+/, "").replace(/\s+A$/, "");
        const name = expandName(rawName);
        if (name.length >= 2) {
          items.push({
            id: Date.now() + Math.random(),
            name,
            rawName,
            category: guessCategory(name),
            qty: "1",
            price: (-gap).toFixed(2)
          });
          report.recovered.push(`${name}: $${(-gap).toFixed(2)} (ledger completion — one unit short, one unpriced item line, printed total names the gap)`);
          break;
        }
      }
    }
  }

  return summarizeLedger(report, items);
}

// receipts print one row per unit when the same product repeats. Single
// trailing letters are flavor/size codes the OCR reads unreliably (M, §->
// dropped, C), so the grouping stem drops them and one character slip is
// tolerated — but only unit-price equality confirms any merge.
function itemUnit(it) {
  const m = String(it.qty).match(/^(\d+) @ \$(\d+\.\d{2})$/);
  return m ? { count: Number(m[1]), unit: parseFloat(m[2]) } : { count: 1, unit: parseFloat(it.price) || 0 };
}

function nameStem(name) {
  const tokens = String(name).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().split(" ");
  while (tokens.length > 1 && tokens[tokens.length - 1].length === 1) tokens.pop();
  return tokens.join(" ");
}

function within1Edit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function collapseItems(items) {
  const groups = [];
  for (const it of items) {
    const { count, unit } = itemUnit(it);
    const stem = nameStem(it.name);
    const g = groups.find((x) =>
      x.unit.toFixed(2) === unit.toFixed(2) &&
      x.stems.some((s) => within1Edit(s, stem)));
    if (g) { g.count += count; g.stems.push(stem); g.members.push(it); }
    else groups.push({ unit, count, stems: [stem], members: [it] });
  }
  return groups.map((g) => {
    if (g.members.length === 1) return g.members[0];
    // the most frequent stem names the merged row
    const freq = {};
    g.stems.forEach((s) => { freq[s] = (freq[s] || 0) + 1; });
    const modal = g.stems.reduce((a, b) => (freq[b] > freq[a] ? b : a));
    const rep = g.members[g.stems.indexOf(modal)];
    const absorbed = [...new Set(g.stems.filter((s) => s !== modal))];
    console.log(`collapse: ${g.members.length} lines -> ${g.count} @ $${g.unit.toFixed(2)} ${rep.name}` +
      (absorbed.length ? ` (absorbed reads: ${absorbed.join(", ")})` : ""));
    return {
      ...rep,
      qty: `${g.count} @ $${g.unit.toFixed(2)}`,
      price: (g.count * g.unit).toFixed(2),
      collapsedFrom: g.members.length
    };
  });
}

async function scanReceipt(file) {
  const canvas = await preprocessReceipt(file);
  const worker = await Tesseract.createWorker("eng");
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const items = parseReceipt(data.text);
    const reconciliation = items.length ? await reconcile(items, data, canvas, worker) : null;
    const collapsed = collapseItems(items);
    if (reconciliation && collapsed.length !== items.length) {
      // collapsing must not bend the ledger — re-prove the checksum on the
      // merged entries
      summarizeLedger(reconciliation, collapsed);
      console.log(`post-collapse ledger: units ${reconciliation.unitsCounted}/${reconciliation.unitsPrinted}, ` +
        `sum $${reconciliation.pricesSum}${reconciliation.taxPrinted ? ` + tax $${reconciliation.taxPrinted}` : ""}, ` +
        `reconciled ${reconciliation.reconciled ? "yes" : "NO"}`);
    }
    return { text: data.text, items: collapsed, reconciliation };
  } finally {
    await worker.terminate();
  }
}

let receiptFile = null;
let correctedCanvas = null; // corner-corrected scan source; null = scan the raw file

// ---- manual 4-corner perspective correction (pre-OCR acquisition layer) ----
// A picked photo renders on a canvas with four draggable corner handles
// (pointer events — one code path for touch and mouse), defaulting to the
// image corners. Confirm warps the marked quad to an upright rectangle in
// pure canvas JS and the warped canvas replaces the raw photo as the scan
// source; Skip keeps the raw photo and is always available. Everything
// downstream of scanReceipt is untouched.

const cornerUI = { bitmap: null, corners: null, drag: -1 };
const HANDLE_GRAB = 28; // css px within which a corner responds to a drag

function sizeCornerCanvas() {
  const canvas = $("#cornerCanvas");
  const bmp = cornerUI.bitmap;
  const cssW = $("#cornerEditor").clientWidth || 360;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssW * (bmp.height / bmp.width) * dpr);
}

function openCornerEditor() {
  const card = $("#receiptCard");
  card.classList.add("editing");
  card.classList.remove("has-photo");
  $("#cornerEditor").hidden = false;
  $("#scanReceiptBtn").disabled = true; // corners or Skip first — one scan source of truth
  sizeCornerCanvas();
  const bmp = cornerUI.bitmap;
  cornerUI.corners = [
    { x: 0, y: 0 }, { x: bmp.width, y: 0 },
    { x: bmp.width, y: bmp.height }, { x: 0, y: bmp.height }
  ];
  drawCornerEditor();
}

// corners live in image pixels, so a resize (rotation, window change) only
// needs the canvas re-sized and re-drawn — debounced, the redraw is heavy
window.addEventListener("resize", () => {
  if (!cornerUI.bitmap || $("#cornerEditor").hidden) return;
  clearTimeout(cornerUI.resizeTimer);
  cornerUI.resizeTimer = setTimeout(() => {
    if (!cornerUI.bitmap || $("#cornerEditor").hidden) return;
    sizeCornerCanvas();
    drawCornerEditor();
  }, 150);
});

function drawCornerEditor() {
  const canvas = $("#cornerCanvas");
  const ctx = canvas.getContext("2d");
  const k = canvas.width / cornerUI.bitmap.width; // image px -> backing px
  ctx.drawImage(cornerUI.bitmap, 0, 0, canvas.width, canvas.height);
  const quad = cornerUI.corners.map((p) => ({ x: p.x * k, y: p.y * k }));
  // veil everything outside the marked quad
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 3; i >= 0; i--) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
  ctx.fillStyle = "rgba(31, 41, 51, .45)";
  ctx.fill("evenodd");
  ctx.lineWidth = Math.max(2, canvas.width / 220);
  ctx.strokeStyle = "#28745c";
  ctx.beginPath();
  quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  const r = Math.max(9, canvas.width / 42);
  quad.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.stroke();
  });
}

function cornerFromEvent(event) {
  const rect = event.target.getBoundingClientRect();
  const sx = cornerUI.bitmap.width / rect.width; // css px -> image px
  return {
    x: Math.min(Math.max((event.clientX - rect.left) * sx, 0), cornerUI.bitmap.width),
    y: Math.min(Math.max((event.clientY - rect.top) * sx, 0), cornerUI.bitmap.height)
  };
}

$("#cornerCanvas").addEventListener("pointerdown", (event) => {
  if (!cornerUI.bitmap) return;
  const rect = event.target.getBoundingClientRect();
  const grab = HANDLE_GRAB * (cornerUI.bitmap.width / rect.width);
  const p = cornerFromEvent(event);
  let best = -1, bestD = grab;
  cornerUI.corners.forEach((c, i) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) { best = i; bestD = d; }
  });
  if (best < 0) return;
  cornerUI.drag = best;
  try { event.target.setPointerCapture(event.pointerId); } catch (e) { /* capture is optional */ }
  event.preventDefault();
});

$("#cornerCanvas").addEventListener("pointermove", (event) => {
  if (cornerUI.drag < 0 || !cornerUI.bitmap) return;
  cornerUI.corners[cornerUI.drag] = cornerFromEvent(event);
  drawCornerEditor();
});

const endCornerDrag = () => { cornerUI.drag = -1; };
$("#cornerCanvas").addEventListener("pointerup", endCornerDrag);
$("#cornerCanvas").addEventListener("pointercancel", endCornerDrag);

// projective map of the marked quad to an upright rectangle: unit-square
// homography (adjugate solve), inverse-mapped with bilinear sampling — pure
// canvas JS, no OpenCV. Output keeps the quad's own edge lengths, capped at
// the proven mobile canvas envelope.
function warpReceipt(sourceImage, corners) {
  const [p0, p1, p2, p3] = corners; // TL, TR, BR, BL
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let outWf = (dist(p0, p1) + dist(p3, p2)) / 2;
  let outHf = (dist(p0, p3) + dist(p1, p2)) / 2;
  if (outWf * outHf > MAX_OCR_PIXELS) {
    const s = Math.sqrt(MAX_OCR_PIXELS / (outWf * outHf));
    outWf *= s; outHf *= s;
  }
  const outW = Math.max(1, Math.round(outWf));
  const outH = Math.max(1, Math.round(outHf));

  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
    g = 0; h = 0;
  } else {
    const d1x = p1.x - p2.x, d1y = p1.y - p2.y;
    const d2x = p3.x - p2.x, d2y = p3.y - p2.y;
    const den = d1x * d2y - d1y * d2x;
    g = (sx * d2y - sy * d2x) / den;
    h = (d1x * sy - d1y * sx) / den;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + h * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + h * p3.y;
    f = p0.y;
  }

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = sourceImage.width;
  srcCanvas.height = sourceImage.height;
  srcCanvas.getContext("2d").drawImage(sourceImage, 0, 0);
  const sctx = srcCanvas.getContext("2d");
  const src = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const sd = src.data, sw = srcCanvas.width, sh = srcCanvas.height;
  const out = new ImageData(outW, outH);
  const od = out.data;
  for (let j = 0; j < outH; j++) {
    const v = j / outH;
    for (let i = 0; i < outW; i++) {
      const u = i / outW;
      const den2 = g * u + h * v + 1;
      let x = (a * u + b * v + c) / den2;
      let y = (d * u + e * v + f) / den2;
      x = Math.min(Math.max(x, 0), sw - 1.001);
      y = Math.min(Math.max(y, 0), sh - 1.001);
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const oi = (j * outW + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        od[oi + ch] =
          sd[i00 + ch] * (1 - fx) * (1 - fy) + sd[i10 + ch] * fx * (1 - fy) +
          sd[i01 + ch] * (1 - fx) * fy + sd[i11 + ch] * fx * fy;
      }
      od[oi + 3] = 255;
    }
  }
  const oc = document.createElement("canvas");
  oc.width = outW;
  oc.height = outH;
  oc.getContext("2d").putImageData(out, 0, 0);
  return oc;
}

// the thumbnail is the confirmation (corrected or raw) — no filename shown
function closeCornerEditor(warped) {
  correctedCanvas = warped;
  const card = $("#receiptCard");
  $("#cornerEditor").hidden = true;
  card.classList.remove("editing");
  const preview = $("#receiptPreview");
  if (warped) {
    warped.toBlob((blob) => { if (blob) preview.src = URL.createObjectURL(blob); }, "image/jpeg", 0.85);
  } else if (receiptFile) {
    preview.src = URL.createObjectURL(receiptFile);
  }
  card.classList.toggle("has-photo", Boolean(receiptFile));
  $("#scanReceiptBtn").disabled = !receiptFile;
  if (cornerUI.bitmap) { cornerUI.bitmap.close(); cornerUI.bitmap = null; }
}

$("#cornerConfirmBtn").addEventListener("click", () => {
  if (!cornerUI.bitmap) return;
  const bmp = cornerUI.bitmap;
  // unmoved handles mark the full frame; warping that is a pure re-encode,
  // which Phase 0 showed can flip glyphs — treat it as Skip
  const tol = Math.max(bmp.width, bmp.height) * 0.01;
  const defaults = [
    { x: 0, y: 0 }, { x: bmp.width, y: 0 },
    { x: bmp.width, y: bmp.height }, { x: 0, y: bmp.height }
  ];
  const untouched = cornerUI.corners.every((c, i) =>
    Math.hypot(c.x - defaults[i].x, c.y - defaults[i].y) <= tol);
  if (untouched) {
    console.log("corner correction: handles at image corners — scanning the raw photo");
    closeCornerEditor(null);
    return;
  }
  const warped = warpReceipt(bmp, cornerUI.corners);
  console.log(`corner correction applied: ${bmp.width}x${bmp.height} -> ${warped.width}x${warped.height}`);
  closeCornerEditor(warped);
});

$("#cornerSkipBtn").addEventListener("click", () => closeCornerEditor(null));

// camera and library inputs feed the same corner editor
function bindReceiptSource(selector) {
  $(selector).addEventListener("change", async (event) => {
    receiptFile = event.target.files[0] || null;
    correctedCanvas = null;
    if (cornerUI.bitmap) { cornerUI.bitmap.close(); cornerUI.bitmap = null; }
    if (!receiptFile) {
      $("#receiptCard").classList.remove("has-photo", "editing");
      $("#cornerEditor").hidden = true;
      $("#scanReceiptBtn").disabled = true;
      return;
    }
    try {
      cornerUI.bitmap = await createImageBitmap(receiptFile);
      openCornerEditor();
    } catch (err) {
      // browsers without createImageBitmap(File) (older iOS) or an
      // undecodable image: fall straight through to the raw flow
      console.error(err);
      closeCornerEditor(null);
    }
  });
}

bindReceiptSource("#receiptCameraInput");
bindReceiptSource("#receiptLibraryInput");

$("#scanReceiptBtn").addEventListener("click", async () => {
  if (!receiptFile) { toast("Choose a receipt photo first"); return; }
  setScanStatus("Reading...", "soon");
  try {
    const source = correctedCanvas || receiptFile;
    console.log(`scan source: ${correctedCanvas
      ? `corner-corrected canvas ${correctedCanvas.width}x${correctedCanvas.height}`
      : "raw photo file"}`);
    const { text, items, reconciliation } = await scanReceipt(source);
    window.lastReceiptText = text;
    window.lastReconciliation = reconciliation;
    if (reconciliation) console.log("reconciliation:", reconciliation);
    if (!items.length) {
      setScanStatus("No items found — try a clearer photo", "urgent");
      toast("Nothing parsed");
      return;
    }
    state.receiptMeta = parseReceiptMeta(text);
    state.reconciliation = reconciliation;
    try { await foodkeeperReady; } catch (e) { /* shelf stays unmatched */ }
    items.forEach((item) => {
      item.purchasedAt = state.receiptMeta.purchasedAt;
      item.shelf = shelfFor(item, item.rawName);
    });
    state.detected = items;
    state.scanned = true;
    state.editingId = null;
    state.addingItem = false;
    renderUpload();
    toast(`${items.length} items detected`);
  } catch (err) {
    console.error(err);
    setScanStatus("Read failed", "urgent");
    toast("Could not read that image");
  }
});

// reveal-screen editing: the parse is a draft the user corrects in place
$("#detectedItems").addEventListener("click", (event) => {
  const editBtn = event.target.closest("[data-edit-detected]");
  if (editBtn) {
    const item = state.detected.find((d) => String(d.id) === editBtn.dataset.editDetected);
    state.editingId = item && state.editingId !== item.id ? item.id : null;
    renderUpload();
    return;
  }

  const qtyBtn = event.target.closest("[data-detected-qty]");
  if (qtyBtn) {
    const item = state.detected.find((d) => String(d.id) === qtyBtn.dataset.detectedQty);
    if (!item) return;
    const { count, unit } = itemUnit(item);
    const next = count + Number(qtyBtn.dataset.delta);
    const before = `${item.qty} ($${item.price})`;
    if (next <= 0) {
      state.detected = state.detected.filter((d) => d.id !== item.id);
      logCorrection("qty", before, "removed");
    } else {
      item.qty = `${next} @ $${unit.toFixed(2)}`;
      item.price = (next * unit).toFixed(2);
      logCorrection("qty", before, `${item.qty} ($${item.price})`);
    }
    refreshLedger();
    renderUpload();
    return;
  }

  const reject = event.target.closest(".reject-btn");
  if (reject) {
    const item = state.detected.find((d) => String(d.id) === reject.dataset.id);
    state.detected = state.detected.filter((d) => String(d.id) !== reject.dataset.id);
    if (item) logCorrection("reject", `${item.name} (${item.qty}, $${item.price})`, "removed");
    refreshLedger();
    renderUpload();
    return;
  }

  if (event.target.closest("[data-add-missed-open]")) {
    state.addingItem = true;
    renderUpload();
    const nameInput = $("#missedName");
    if (nameInput) nameInput.focus();
    return;
  }
  if (event.target.closest("[data-add-missed-cancel]")) {
    state.addingItem = false;
    renderUpload();
  }
});

// Enter in the name field commits the edit (fires the change handler)
$("#detectedItems").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("[data-name-edit]")) {
    event.preventDefault();
    event.target.blur();
  }
});

$("#detectedItems").addEventListener("change", (event) => {
  const nameEdit = event.target.closest("[data-name-edit]");
  if (nameEdit) {
    const item = state.detected.find((d) => String(d.id) === nameEdit.dataset.nameEdit);
    const next = nameEdit.value.trim();
    if (item && next && next !== item.name) {
      logCorrection("name", item.name, next);
      item.name = next;
      item.rawName = null; // the user's words replace the OCR read for matching
      if (!item.categoryEdited) item.category = guessCategory(next);
      if (!item.shelfLocked) item.shelf = shelfFor(item, null);
    }
    renderUpload();
    return;
  }

  const catEdit = event.target.closest("[data-category-edit]");
  if (catEdit) {
    const item = state.detected.find((d) => String(d.id) === catEdit.dataset.categoryEdit);
    if (item && catEdit.value !== item.category) {
      logCorrection("category", item.category, catEdit.value);
      item.category = catEdit.value;
      item.categoryEdited = true;
      if (!item.shelfLocked) item.shelf = shelfFor(item, item.rawName);
    }
    renderUpload();
    return;
  }

  const shelfEdit = event.target.closest("[data-shelf-edit]");
  if (shelfEdit) {
    const item = state.detected.find((d) => String(d.id) === shelfEdit.dataset.shelfEdit);
    if (!item) return;
    const before = item.shelf ? `${item.shelf.match} (${item.shelf.loc}, ~${item.shelf.midDays}d)` : "no estimate";
    if (shelfEdit.value === "none") {
      item.shelf = null;
    } else {
      const [idx, loc] = shelfEdit.value.split("|");
      const entry = rankShelfCandidates([item.rawName, item.name], item.category, 4)[Number(idx)];
      if (entry && entry[loc]) {
        const info = shelfInfoFrom(entry, loc);
        const purchased = new Date(item.purchasedAt || Date.now());
        item.shelf = { ...info, expiresAt: new Date(purchased.getTime() + info.midDays * DAY_MS).toISOString() };
      }
    }
    item.shelfLocked = true;
    const after = item.shelf ? `${item.shelf.match} (${item.shelf.loc}, ~${item.shelf.midDays}d)` : "no estimate";
    logCorrection("shelf", before, after);
    renderUpload();
  }
});

document.addEventListener("submit", (event) => {
  if (!event.target.matches("#addMissedForm")) return;
  event.preventDefault();
  const name = $("#missedName").value.trim();
  if (!name) return;
  const count = Math.max(1, Math.round(Number($("#missedQty").value) || 1));
  const lineTotal = Math.max(0, Number($("#missedPrice").value) || 0);
  const item = {
    id: Date.now() + Math.random(),
    name,
    rawName: null,
    category: guessCategory(name),
    qty: count > 1 ? `${count} @ $${(lineTotal / count).toFixed(2)}` : "1",
    price: lineTotal.toFixed(2),
    purchasedAt: state.receiptMeta ? state.receiptMeta.purchasedAt : new Date().toISOString()
  };
  item.shelf = shelfFor(item, null);
  state.detected.push(item);
  logCorrection("add", null, `${item.name} (${item.qty}, $${item.price})`);
  state.addingItem = false;
  refreshLedger();
  renderUpload();
});

$("#addDetectedBtn").addEventListener("click", async () => {
  const meta = state.receiptMeta || parseReceiptMeta(window.lastReceiptText);
  try { await foodkeeperReady; } catch (e) { /* shelf stays unmatched */ }
  // shelf previews (including manual overrides) were settled on the reveal
  // screen — corrected values flow into the pantry exactly as parsed ones do
  const entries = state.detected.map((item) => ({
    ...item,
    id: Date.now() + Math.random(),
    purchasedAt: item.purchasedAt || meta.purchasedAt,
    tripId: meta.tripId
  }));
  entries.forEach((entry) => {
    state.pantry.push(entry);
    logEvent("purchase", entry);
  });
  const history = recordPurchases(entries, meta);
  console.log(`trip recorded: ${meta.tripId} (purchase date ${meta.purchasedAt.slice(0, 10)})`);
  console.table(entries.map((e) => ({
    item: e.name,
    shelf_match: e.shelf ? e.shelf.match : "— no data",
    where: e.shelf ? e.shelf.loc : "",
    est_expiry: e.shelf ? e.shelf.expiresAt.slice(0, 10) : ""
  })));
  console.log("purchase history:", history);
  console.log("trips per item:", Object.fromEntries(
    Object.entries(history).map(([k, v]) => [k, new Set(v.map((r) => r.tripId)).size])));
  state.scanned = false;
  state.editingId = null;
  state.addingItem = false;
  state.groceryList = [];
  saveState();
  render();
  toast("Detected items added");
  setView("pantry");
});

$("#generateListBtn").addEventListener("click", generateListFromPantry);

$("#createListBtn").addEventListener("click", () => {
  const count = state.groceryList.filter((item) => !item.done).length;
  saveState();
  toast(`${count} grocery items ready`);
});

$("#resetBtn").addEventListener("click", () => {
  if (confirm("Reset SmartPantry data?")) resetState();
});

// ---- QA debug harness — invisible unless localStorage.spDebug === "1" or
// the page is opened with ?debug=1. Everything it creates is synthetic and
// QA-only. The chip marks the app whenever the harness is active.
const debugActive = (() => {
  try {
    return localStorage.getItem("spDebug") === "1"
      || new URLSearchParams(location.search).get("debug") === "1";
  } catch (e) { return false; }
})();

if (debugActive) {
  const chip = document.createElement("div");
  chip.className = "qa-chip";
  document.body.appendChild(chip);
  const syncChip = () => {
    chip.textContent = todayOverride ? `QA · today = ${todayOverride.toISOString().slice(0, 10)}` : "QA";
  };
  syncChip();

  window.spqa = {
    // pretend today is a different date for tag/list QA; setToday("") restores
    setToday(iso) {
      todayOverride = iso ? new Date(iso) : null;
      syncChip();
      render();
      return todayOverride ? `today = ${todayOverride.toISOString().slice(0, 10)}` : "today = real time";
    },
    // synthetic backdated haul covering expired / expiring / low / healthy /
    // no-data in one shot
    async seed() {
      try { await foodkeeperReady; } catch (e) { /* no-data everywhere is still a valid fixture */ }
      const day = (n) => new Date(nowMs() - n * DAY_MS).toISOString();
      const mk = (name, category, daysAgo, qty, price) => {
        const item = {
          id: Date.now() + Math.random(),
          name, rawName: null, category, qty, price,
          purchasedAt: day(daysAgo),
          tripId: `QA-SEED-${daysAgo}d`
        };
        item.shelf = shelfFor(item, null);
        return item;
      };
      const items = [
        mk("Cherry Yogurt", "Dairy", 13, "1", "1.19"),                 // fridge ~11d -> expired
        mk("Sliced Turkey Breast", "Protein", 1, "1", "5.99"),         // fridge ~2d -> expiring
        mk("Ground Coffee", "Beverages", 8, "1", "9.99"),              // low via the 2-trip history below
        mk("Oil Coconut Virgin (Organic)", "Pantry", 5, "1", "4.99"),  // healthy, untagged
        mk("Meal Instant Ramen Cup", "Pantry", 3, "6 @ $1.89", "11.34") // no shelf data
      ];
      state.pantry.push(...items);
      const history = readStore(HISTORY_KEY);
      history[nameStem("Ground Coffee")] = [
        { date: day(16).slice(0, 10), qty: 1, unit: 9.99, tripId: "QA-SEED-trip1" },
        { date: day(8).slice(0, 10), qty: 1, unit: 9.99, tripId: "QA-SEED-trip2" }
      ];
      writeStore(HISTORY_KEY, history);
      historyMemo = null;
      saveState();
      render();
      console.log("QA fixture seeded (synthetic — QA only, never claims data):", items.map((i) => i.name));
      return "seeded 5 items: expired / expiring / low / healthy / no data";
    },
    reset() { resetState(); }
  };
  console.log("QA harness active — spqa.setToday(iso), spqa.seed(), spqa.reset()");
}

render();
