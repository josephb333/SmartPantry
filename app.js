const state = {
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
  detected: [
    { id: "d1", name: "Spinach", category: "Produce", qty: "1 bag", status: "In Stock" },
    { id: "d2", name: "Coffee", category: "Pantry", qty: "1 bag", status: "In Stock" },
    { id: "d3", name: "Orange Juice", category: "Dairy", qty: "1 carton", status: "In Stock" }
  ]
};

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
    ? state.detected.map((item) => renderItemRow(item, { badge: "Detected" })).join("")
    : `<p class="text-secondary">Process a receipt to preview extracted items.</p>`;
  $("#scanStatus").textContent = state.scanned ? "3 found" : "Ready";
  $("#addDetectedBtn").disabled = !state.scanned;
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
    render();
  }

  const remove = event.target.closest("[data-delete-item]");
  if (remove) {
    state.pantry = state.pantry.filter((item) => item.id !== Number(remove.dataset.deleteItem));
    state.groceryList = [];
    render();
  }

  const suggestion = event.target.closest("[data-add-suggestion]");
  if (suggestion) {
    const item = state.suggestions.find((entry) => entry.id === suggestion.dataset.addSuggestion);
    state.groceryList.push({ id: Date.now(), name: item.name, qty: "Suggested", status: "Buy Soon", done: false });
    state.suggestions = state.suggestions.filter((entry) => entry.id !== item.id);
    renderGroceryList();
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-toggle-list]")) return;
  const item = state.groceryList.find((entry) => String(entry.id) === event.target.dataset.toggleList);
  item.done = event.target.checked;
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
  renderGroceryList();
});

$("#scanReceiptBtn").addEventListener("click", () => {
  state.scanned = true;
  renderUpload();
  toast("Receipt processed");
});

$("#addDetectedBtn").addEventListener("click", () => {
  state.detected.forEach((item) => {
    state.pantry.push({ ...item, id: Date.now() + Math.random() });
  });
  state.scanned = false;
  state.groceryList = [];
  render();
  toast("Detected items added");
  setView("pantry");
});

$("#createListBtn").addEventListener("click", () => {
  const count = state.groceryList.filter((item) => !item.done).length;
  toast(`${count} grocery items ready`);
});

render();
