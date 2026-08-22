const defaultState = {
  view: "home",
  category: "All",
  statusFilter: null,
  search: "",
  scanned: false,
  pantry: [
    { id: 1, name: "Whole Milk", category: "Dairy", qty: "1 carton", status: "Running Low" },
    { id: 2, name: "Large Eggs", category: "Dairy", qty: "12 count", status: "In Stock" },
    { id: 3, name: "Greek Yogurt", category: "Dairy", qty: "2 cups", status: "Running Low" },
    { id: 4, name: "Sourdough Bread", category: "Bakery", qty: "0 loaves", status: "Buy Now" },
    { id: 5, name: "Olive Oil", category: "Pantry", qty: "1/4 bottle", status: "Buy Soon" },
    { id: 6, name: "Pasta", category: "Pantry", qty: "2 boxes", status: "In Stock" },
    { id: 7, name: "Bananas", category: "Produce", qty: "2 left", status: "Buy Soon" }
  ],
  groceryList: [],
  suggestions: [
    { id: "s1", name: "Butter", reason: "Usually bought every 2 weeks" },
    { id: "s2", name: "Chicken Breast", reason: "Roommate dinner pattern" }
  ],
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
  location.reload();
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

function renderItemRow(item, options = {}) {
  const check = options.checkbox
    ? `<input class="form-check-input" type="checkbox" ${item.done ? "checked" : ""} data-toggle-list="${item.id}">`
    : `<span aria-hidden="true">${options.dot || ""}</span>`;
  const actions = options.pantryActions
    ? `<div class="row-actions">
        <button class="mini-button" type="button" data-cycle-status="${item.id}">Status</button>
        <button class="mini-button" type="button" data-delete-item="${item.id}">Delete</button>
      </div>`
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
  $("#attentionItems").innerHTML = buyNow.concat(state.pantry.filter((item) => item.status === "Buy Soon"))
    .slice(0, 5)
    .map((item) => renderItemRow(item))
    .join("");
}

function renderPantry() {
  const query = state.search.trim().toLowerCase();
  const visible = state.pantry.filter((item) => {
    const matchesCategory = state.category === "All" || item.category === state.category;
    const matchesStatus = !state.statusFilter || item.status === state.statusFilter;
    const matchesSearch = !query || item.name.toLowerCase().includes(query);
    return matchesCategory && matchesStatus && matchesSearch;
  });
  const groups = [...new Set(visible.map((item) => item.category))];
  $("#pantryItems").innerHTML = groups.map((category) => `
    <section>
      <h3 class="category-title">${category}</h3>
      ${visible.filter((item) => item.category === category).map((item) => renderItemRow(item, { pantryActions: true })).join("")}
    </section>
  `).join("") || `<p class="text-secondary">No matching pantry items.</p>`;
}

function ensureGroceryList() {
  if (state.groceryList.length) return;
  state.groceryList = state.pantry
    .filter((item) => ["Buy Now", "Running Low", "Buy Soon"].includes(item.status))
    .map((item) => ({ ...item, done: false }));
}

function renderGroceryList() {
  ensureGroceryList();
  $("#groceryItems").innerHTML = state.groceryList.map((item) => renderItemRow(item, { checkbox: true })).join("");
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
  $("#scanStatus").textContent = state.scanned ? `${state.detected.length} found` : "Ready";  
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

function nextStatus(status) {
  return {
    "In Stock": "Running Low",
    "Running Low": "Buy Soon",
    "Buy Soon": "Buy Now",
    "Buy Now": "In Stock"
  }[status];
}

// abbrev → real name; keys are actual OCR output strings from real runs
const NAME_MAP = {
  "ER OKYR CHERRY": "Cherry Yogurt",
  "VEGGIE STICKS POTATO SNA": "Veggie Sticks Potato Snacks",
  "SLICED TURKEY BREAST ROA": "Sliced Turkey Breast",
  "TORTILLAS ORG SPROUTED W": "Organic Sprouted Wheat Tortillas",
  "A-APPLE BAG SUGARBEE": "SugarBee Apples 2lb Bag",
  "OATMEAL INSTANT MAPLE BR": "Instant Oatmeal Maple Brown Sugar"
};

const CATEGORY_HINTS = {
  "yogurt": "Dairy",
  "cheese": "Dairy",
  "milk": "Dairy",
  "bread": "Bakery",
  "tortilla": "Bakery",
  "apple": "Produce",
  "banana": "Produce",
  "grape": "Produce",
  "lettuce": "Produce",
  "mango": "Produce",
  "turkey": "Protein",
  "jerky": "Protein",
  "chicken": "Protein"
};

function expandName(raw) {
  const upper = raw.toUpperCase();
  for (const [abbrev, full] of Object.entries(NAME_MAP)) {
    if (upper.includes(abbrev.toUpperCase())) return full;
  }
  return raw;
}

function guessCategory(name) {
  const lower = name.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_HINTS)) {
    if (lower.includes(keyword)) return category;
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

  const cycle = event.target.closest("[data-cycle-status]");
  if (cycle) {
    const item = state.pantry.find((entry) => entry.id === Number(cycle.dataset.cycleStatus));
    item.status = nextStatus(item.status);
    state.groceryList = [];
    saveState();
    render();
  }

  const remove = event.target.closest("[data-delete-item]");
  if (remove) {
    state.pantry = state.pantry.filter((item) => item.id !== Number(remove.dataset.deleteItem));
    state.groceryList = [];
    saveState();
    render();
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
    qty: "Manual entry",
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
  state.groceryList.push({
    id: Date.now(),
    name: $("#extraItemName").value,
    qty: "Manual list item",
    status: "Buy Now",
    done: false
  });
  event.target.reset();
  saveState();
  renderGroceryList();
});

let receiptFile = null;

$("#receiptInput").addEventListener("change", (event) => {
  receiptFile = event.target.files[0] || null;
  const preview = $("#receiptPreview");
  if (receiptFile) {
    preview.src = URL.createObjectURL(receiptFile);
    preview.style.display = "block";
    $("#previewLabel").style.display = "none";
  } else {
    preview.style.display = "none";
    $("#previewLabel").style.display = "";
  }
});

$("#scanReceiptBtn").addEventListener("click", async () => {
  if (!receiptFile) { toast("Choose a receipt photo first"); return; }
  $("#scanStatus").textContent = "Reading...";
  try {
    const result = await Tesseract.recognize(receiptFile, "eng");
    window.lastReceiptText = result.data.text;
    const items = parseReceipt(result.data.text);
    if (!items.length) {
      $("#scanStatus").textContent = "No items found — try a clearer photo";
      toast("Nothing parsed");
      return;
    }
    state.detected = items;
    state.scanned = true;
    renderUpload();
    toast(`${items.length} items detected`);
  } catch (err) {
    console.error(err);
    $("#scanStatus").textContent = "Read failed";
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
  if (confirm("Reset Smart Pantry to demo data?")) resetState();
});

render();
