const defaultState = {
  view: "home",
  category: "All",
  statusFilter: null,
  search: "",
  scanned: false,
  pantry: [],
  groceryList: [],
  suggestions: [],
  detected: []
};

const STORAGE_KEY = "smartpantry";

function loadState() {
  const fresh = structuredClone(defaultState);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      fresh.pantry = saved.pantry ?? fresh.pantry;
      fresh.groceryList = saved.groceryList ?? fresh.groceryList;
      fresh.suggestions = saved.suggestions ?? fresh.suggestions;
    }
  } catch (e) { /* corrupted data, fall back to defaults */ }
  return fresh;
}

const state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    pantry: state.pantry,
    groceryList: state.groceryList,
    suggestions: state.suggestions
  }));
}

function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(EVENT_LOG_KEY);
  localStorage.removeItem(ADJUST_LOG_KEY);
  location.reload();
}

const EVENT_LOG_KEY = "smartpantry_events";
const ADJUST_LOG_KEY = "smartpantry_adjustments";

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

const statusClass = {
  "Buy Now": "urgent",
  "Running Low": "urgent",
  "Buy Soon": "soon",
  "In Stock": "stocked"
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

function statusBadge(status) {
  return `<span class="status-pill ${statusClass[status] || "neutral"}">${status}</span>`;
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
      : statusBadge(item.status || options.badge || "");

  return `
    <div class="item-row ${item.done ? "done" : ""}">
      ${check}
      <div>
        <div class="item-name">${item.name}</div>
        <div class="item-meta">${item.qty || item.reason || item.category || ""}</div>
      </div>
      ${actions}
    </div>
  `;
}

function renderHome() {
  const buyNow = state.pantry.filter((item) => item.status === "Buy Now" || item.status === "Running Low");
  $("#buyNowCount").textContent = buyNow.length;
  $("#buySoonCount").textContent = state.pantry.filter((item) => item.status === "Buy Soon").length;
  $("#stockedCount").textContent = state.pantry.filter((item) => item.status === "In Stock").length;
  const attention = buyNow.concat(state.pantry.filter((item) => item.status === "Buy Soon")).slice(0, 5);
  $("#attentionViewAll").style.display = attention.length ? "" : "none";
  $("#attentionItems").innerHTML = attention.length
    ? attention.map((item) => renderItemRow(item)).join("")
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
  const visible = state.pantry.filter((item) => {
    const matchesCategory = state.category === "All" || item.category === state.category;
    const matchesStatus = !state.statusFilter || item.status === state.statusFilter;
    const matchesSearch = !query || item.name.toLowerCase().includes(query);
    return matchesCategory && matchesStatus && matchesSearch;
  });
  const groups = [...new Set(visible.map((item) => item.category))];
  const groupHtml = groups.map((category) => `
    <section>
      <h3 class="category-title">${category}</h3>
      ${visible.filter((item) => item.category === category).map((item) => renderItemRow(item, { pantryActions: true })).join("")}
    </section>
  `).join("") || `<p class="text-secondary">No matching pantry items.</p>`;
  $("#pantryItems").innerHTML = `<p class="whisper">+ / − to adjust by hand. The pantry keeps count.</p>` + groupHtml;
}

function ensureGroceryList() {
  if (state.groceryList.length) return;
  state.groceryList = state.pantry
    .filter((item) => ["Buy Now", "Running Low", "Buy Soon"].includes(item.status))
    .map((item) => ({ ...item, done: false }));
}

function renderGroceryList() {
  ensureGroceryList();
  $("#groceryItems").innerHTML = state.groceryList.map((item) => renderItemRow(item, { checkbox: true, removable: true })).join("");
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

function renderUpload() {
  $("#detectedItems").innerHTML = state.scanned
    ? state.detected.map((item) => `
        <div class="item-row">
          <span></span>
          <div>
            <div class="item-name">${item.name}</div>
            <div class="item-meta">${item.qty}</div>
          </div>
          <button class="mini-button reject-btn" type="button" data-id="${item.id}">Reject?</button>
        </div>
      `).join("")
    : `<p class="text-secondary">Process a receipt to preview extracted items.</p>`;
  setScanStatus(state.scanned ? `${state.detected.length} found${state.reconBadge || ""}` : "Ready", "stocked");
  const addBtn = $("#addDetectedBtn");
  const showConfirm = state.scanned && state.detected.length > 0;
  addBtn.style.display = showConfirm ? "" : "none";
  addBtn.disabled = !showConfirm;
  addBtn.classList.toggle("ready", showConfirm);
}

function render() {
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

const JUNK = /TOTAL|SUBTOTAL|TAX|CHANGE|DEBIT|CREDIT|VISA|MASTERCARD|CASH|BALANCE|SAVINGS|COUPON|THANK/i;
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
      category,
      qty: "1",
      price: priceMatch[1].replace(",", "."),
      status: "In Stock"
    });
  }
  console.table(tableRows);
  return items;
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    if (viewButton.dataset.filterStatus) state.statusFilter = viewButton.dataset.filterStatus;
    setView(viewButton.dataset.view);
  }

  const filter = event.target.closest("[data-category]");
  if (filter) {
    state.category = filter.dataset.category;
    state.statusFilter = null;
    $$(".filter-chip").forEach((button) => button.classList.toggle("active", button === filter));
    renderPantry();
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
    state.groceryList = state.groceryList.filter((item) => String(item.id) !== removeList.dataset.removeList);
    saveState();
    renderGroceryList();
  }

  const suggestion = event.target.closest("[data-add-suggestion]");
  if (suggestion) {
    const item = state.suggestions.find((entry) => entry.id === suggestion.dataset.addSuggestion);
    state.groceryList.push({ id: Date.now(), name: item.name, qty: "Suggested", status: "Buy Soon", done: false });
    state.suggestions = state.suggestions.filter((entry) => entry.id !== item.id);
    saveState();
    renderGroceryList();
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

$("#addItemForm").addEventListener("submit", (event) => {
  event.preventDefault();
  state.pantry.push({
    id: Date.now(),
    name: $("#newItemName").value,
    category: $("#newItemCategory").value,
    qty: "1",
    status: $("#newItemStatus").value
  });
  event.target.reset();
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
    status: "Buy Now",
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

async function preprocessReceipt(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("could not load receipt image"));
    });
    const factor = Math.max(1, Math.min(2, Math.sqrt(MAX_OCR_PIXELS / (img.naturalWidth * img.naturalHeight))));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * factor);
    canvas.height = Math.round(img.naturalHeight * factor);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

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
    URL.revokeObjectURL(img.src);
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

  const totalCandidates = [];
  rawLines.forEach((l) => {
    if (/SUBTOTAL|TAX/i.test(l)) return;
    if (!/TOTAL|BALANCE|VISA|MASTERCARD|DEBIT|CREDIT|CASH/i.test(l)) return;
    (l.match(MONEY) || []).forEach((m) => totalCandidates.push(parseMoney(m)));
  });
  report.totalPrinted = totalCandidates.length ? totalCandidates : null;

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

  report.unitsCounted = items.reduce((s, it) => {
    const m = String(it.qty).match(/^(\d+) @/);
    return s + (m ? Number(m[1]) : 1);
  }, 0);
  report.unitsMatch = report.unitsPrinted != null && report.unitsCounted === report.unitsPrinted;
  const pricesSum = items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0);
  report.pricesSum = +pricesSum.toFixed(2);
  report.totalMatch = (report.totalPrinted || []).some((t) => Math.abs(t - pricesSum) <= 0.02);
  report.reconciled = report.unitsMatch && report.totalMatch;
  return report;
}

async function scanReceipt(file) {
  const canvas = await preprocessReceipt(file);
  const worker = await Tesseract.createWorker("eng");
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const items = parseReceipt(data.text);
    const reconciliation = items.length ? await reconcile(items, data, canvas, worker) : null;
    return { text: data.text, items, reconciliation };
  } finally {
    await worker.terminate();
  }
}

let receiptFile = null;

// camera and library inputs feed the same preview; the thumbnail is the
// confirmation, so no filename is ever shown
function bindReceiptSource(selector) {
  $(selector).addEventListener("change", (event) => {
    receiptFile = event.target.files[0] || null;
    if (receiptFile) $("#receiptPreview").src = URL.createObjectURL(receiptFile);
    $("#receiptCard").classList.toggle("has-photo", Boolean(receiptFile));
    $("#scanReceiptBtn").disabled = !receiptFile;
  });
}

bindReceiptSource("#receiptCameraInput");
bindReceiptSource("#receiptLibraryInput");

$("#scanReceiptBtn").addEventListener("click", async () => {
  if (!receiptFile) { toast("Choose a receipt photo first"); return; }
  setScanStatus("Reading...", "soon");
  try {
    const { text, items, reconciliation } = await scanReceipt(receiptFile);
    window.lastReceiptText = text;
    window.lastReconciliation = reconciliation;
    if (reconciliation) console.log("reconciliation:", reconciliation);
    state.reconBadge = badgeFor(reconciliation);
    if (!items.length) {
      setScanStatus("No items found — try a clearer photo", "urgent");
      toast("Nothing parsed");
      return;
    }
    state.detected = items;
    state.scanned = true;
    renderUpload();
    toast(`${items.length} items detected`);
  } catch (err) {
    console.error(err);
    setScanStatus("Read failed", "urgent");
    toast("Could not read that image");
  }
});

$("#detectedItems").addEventListener("click", (event) => {
  const btn = event.target.closest(".reject-btn");
  if (!btn) return;
  state.detected = state.detected.filter((item) => String(item.id) !== btn.dataset.id);
  renderUpload();
});

$("#addDetectedBtn").addEventListener("click", () => {
  state.detected.forEach((item) => {
    state.pantry.push({ ...item, id: Date.now() + Math.random() });
    logEvent("purchase", item);
  });
  state.scanned = false;
  state.groceryList = [];
  saveState();
  render();
  toast("Detected items added");
  setView("pantry");
});

$("#createListBtn").addEventListener("click", () => {
  const count = state.groceryList.filter((item) => !item.done).length;
  saveState();
  toast(`${count} grocery items ready`);
});

$("#resetBtn").addEventListener("click", () => {
  if (confirm("Reset SmartPantry data?")) resetState();
});

render();
