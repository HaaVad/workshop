(() => {
  const STORAGE_KEY = "faktura-draft-v1";
  const VAT_RATES = [25, 15, 12, 0];

  const SIMPLE_FIELD_IDS = [
    "seller-name", "seller-orgnr", "seller-address", "seller-account", "seller-email", "seller-phone",
    "buyer-name", "buyer-address",
    "invoice-number", "invoice-kid", "invoice-date", "due-date", "terms",
  ];

  const main = document.querySelector("main");
  const itemsEl = document.getElementById("items");
  const totalsEl = document.getElementById("totals");
  const vatCheckbox = document.getElementById("vat-registered");
  const actionBarAmount = document.getElementById("action-bar-amount");

  const nf = new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  let items = [];
  let nextId = 1;

  function isoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function toNumber(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function escapeAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatKr(n) {
    return nf.format(n || 0);
  }

  function makeItem() {
    return { id: nextId++, desc: "", qty: 1, price: 0, vat: 25 };
  }

  function lineTotal(item) {
    return toNumber(item.qty) * toNumber(item.price);
  }

  function getSimpleFields() {
    const obj = {};
    SIMPLE_FIELD_IDS.forEach((id) => {
      obj[id] = document.getElementById(id).value;
    });
    return obj;
  }

  function setSimpleFields(obj) {
    if (!obj) return;
    SIMPLE_FIELD_IDS.forEach((id) => {
      if (obj[id] !== undefined) document.getElementById(id).value = obj[id];
    });
  }

  function save() {
    const state = {
      fields: getSimpleFields(),
      vatRegistered: vatCheckbox.checked,
      items,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      saved = null;
    }

    if (saved && Array.isArray(saved.items) && saved.items.length) {
      setSimpleFields(saved.fields);
      vatCheckbox.checked = saved.vatRegistered !== false;
      items = saved.items;
      nextId = Math.max(...items.map((i) => i.id), 0) + 1;
    } else {
      items = [makeItem()];
    }

    const dateEl = document.getElementById("invoice-date");
    const dueEl = document.getElementById("due-date");
    if (!dateEl.value) dateEl.value = isoDate(new Date());
    if (!dueEl.value) dueEl.value = isoDate(new Date(Date.now() + 14 * 86400000));
  }

  function itemRowHTML(item) {
    const options = VAT_RATES.map(
      (r) => `<option value="${r}" ${Number(item.vat) === r ? "selected" : ""}>${r} %</option>`
    ).join("");

    return `
      <div class="item" data-id="${item.id}">
        <button type="button" class="item-remove no-print" data-remove="${item.id}" aria-label="Fjern linje">×</button>
        <div class="field">
          <label>Beskrivelse</label>
          <input type="text" data-field="desc" data-id="${item.id}" value="${escapeAttr(item.desc)}" placeholder="Beskrivelse av vare/tjeneste">
        </div>
        <div class="item-row">
          <div class="field">
            <label>Antall</label>
            <input type="number" inputmode="decimal" step="any" min="0" data-field="qty" data-id="${item.id}" value="${escapeAttr(item.qty)}">
          </div>
          <div class="field">
            <label>Pris (eks. mva)</label>
            <input type="number" inputmode="decimal" step="0.01" min="0" data-field="price" data-id="${item.id}" value="${escapeAttr(item.price)}">
          </div>
        </div>
        <div class="item-row">
          <div class="field vat-field">
            <label>Mva</label>
            <select data-field="vat" data-id="${item.id}">${options}</select>
          </div>
          <div class="item-line-total">
            <span class="line-total-label">Linjesum eks. mva</span>
            <span data-total-for="${item.id}">${formatKr(lineTotal(item))}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderItems() {
    itemsEl.innerHTML = items.map(itemRowHTML).join("");
    applyVatVisibility();
  }

  function applyVatVisibility() {
    document.querySelectorAll(".vat-field").forEach((el) => {
      el.classList.toggle("vat-hidden", !vatCheckbox.checked);
    });
  }

  function computeTotals() {
    const sumEks = items.reduce((sum, item) => sum + lineTotal(item), 0);
    const vatByRate = {};

    if (vatCheckbox.checked) {
      items.forEach((item) => {
        const rate = toNumber(item.vat);
        const amount = (lineTotal(item) * rate) / 100;
        vatByRate[rate] = (vatByRate[rate] || 0) + amount;
      });
    }

    const totalVat = Object.values(vatByRate).reduce((sum, v) => sum + v, 0);
    return { sumEks, vatByRate, totalVat, grandTotal: sumEks + totalVat };
  }

  function updateTotals() {
    const t = computeTotals();

    const rateRows = Object.keys(t.vatByRate)
      .map(Number)
      .filter((r) => r > 0)
      .sort((a, b) => b - a)
      .map((r) => `<div class="totals-row"><span>Mva ${r} %</span><span>${formatKr(t.vatByRate[r])}</span></div>`)
      .join("");

    totalsEl.innerHTML = `
      <div class="totals-row"><span>Sum eks. mva</span><span>${formatKr(t.sumEks)}</span></div>
      ${vatCheckbox.checked ? rateRows : ""}
      <div class="totals-row grand"><span>Totalt å betale</span><span>${formatKr(t.grandTotal)}</span></div>
    `;

    actionBarAmount.textContent = formatKr(t.grandTotal);
  }

  function updateHints() {
    document.getElementById("seller-hint").textContent = document.getElementById("seller-name").value || "";
    document.getElementById("buyer-hint").textContent = document.getElementById("buyer-name").value || "";
  }

  function handleItemFieldChange(e) {
    const field = e.target.dataset.field;
    if (!field) return;

    const id = Number(e.target.dataset.id);
    const item = items.find((i) => i.id === id);
    if (!item) return;

    item[field] = e.target.value;

    const totalEl = itemsEl.querySelector(`[data-total-for="${id}"]`);
    if (totalEl) totalEl.textContent = formatKr(lineTotal(item));

    updateTotals();
    save();
  }

  itemsEl.addEventListener("input", handleItemFieldChange);
  itemsEl.addEventListener("change", handleItemFieldChange);

  itemsEl.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (!removeBtn) return;

    const id = Number(removeBtn.dataset.remove);
    items = items.filter((i) => i.id !== id);
    if (items.length === 0) items.push(makeItem());

    renderItems();
    updateTotals();
    save();
  });

  document.getElementById("add-item").addEventListener("click", () => {
    items.push(makeItem());
    renderItems();
    updateTotals();
    save();

    requestAnimationFrame(() => {
      const lastInput = itemsEl.querySelector(".item:last-child input");
      lastInput?.focus();
      lastInput?.scrollIntoView({ block: "center" });
    });
  });

  vatCheckbox.addEventListener("change", () => {
    applyVatVisibility();
    updateTotals();
    save();
  });

  document.getElementById("print-btn").addEventListener("click", () => {
    window.print();
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!confirm("Nullstille fakturaen og fjerne lagret utkast?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  main.addEventListener("input", (e) => {
    if (e.target.closest("#items")) return;
    if (e.target.id === "seller-name" || e.target.id === "buyer-name") updateHints();
    save();
  });

  load();
  renderItems();
  updateTotals();
  updateHints();
})();
