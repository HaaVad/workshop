(function () {
  "use strict";

  var STORAGE_KEY = "faktura-draft-v1";
  var VAT_RATES = [25, 15, 12, 0];

  var invoiceEl = document.getElementById("invoice");
  var itemsBody = document.getElementById("items-body");
  var totalsBox = document.getElementById("totals-box");
  var mvaCheckbox = document.getElementById("mva-registered");

  // ---------- helpers ----------

  function todayISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function addDaysISO(iso, days) {
    var d = new Date(iso);
    d.setDate(d.getDate() + days);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function fmtMoney(n) {
    return new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: 2,
    }).format(n || 0);
  }

  // ---------- line items ----------

  function makeRow(item) {
    item = item || { desc: "", qty: 1, price: 0, vat: 25 };
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="col-desc"><input data-item="desc" placeholder="Beskrivelse"></td>' +
      '<td class="col-qty"><input data-item="qty" type="number" min="0" step="1"></td>' +
      '<td class="col-price"><input data-item="price" type="number" min="0" step="0.01"></td>' +
      '<td class="col-vat"><select data-item="vat">' +
      VAT_RATES.map(function (r) { return '<option value="' + r + '">' + r + "%</option>"; }).join("") +
      "</select></td>" +
      '<td class="col-sum"><span class="line-sum"></span></td>' +
      '<td class="col-del no-print"><button type="button" class="del-row" aria-label="Fjern linje">&times;</button></td>';
    tr.querySelector('[data-item="desc"]').value = item.desc;
    tr.querySelector('[data-item="qty"]').value = item.qty;
    tr.querySelector('[data-item="price"]').value = item.price;
    tr.querySelector('[data-item="vat"]').value = String(item.vat);
    return tr;
  }

  function addRow(item) {
    itemsBody.appendChild(makeRow(item));
    recalc();
  }

  function removeRow(tr) {
    if (itemsBody.children.length <= 1) return;
    tr.remove();
    recalc();
    save();
  }

  function readItems() {
    return Array.prototype.map.call(itemsBody.children, function (tr) {
      return {
        desc: tr.querySelector('[data-item="desc"]').value,
        qty: parseFloat(tr.querySelector('[data-item="qty"]').value) || 0,
        price: parseFloat(tr.querySelector('[data-item="price"]').value) || 0,
        vat: parseFloat(tr.querySelector('[data-item="vat"]').value) || 0,
      };
    });
  }

  // ---------- totals ----------

  function recalc() {
    var mvaOn = mvaCheckbox.checked;
    invoiceEl.classList.toggle("mva-off", !mvaOn);

    var items = readItems();
    var sumExcl = 0;
    var vatGroups = {};

    Array.prototype.forEach.call(itemsBody.children, function (tr, i) {
      var it = items[i];
      var lineExcl = it.qty * it.price;
      var rate = mvaOn ? it.vat : 0;
      var lineVat = lineExcl * (rate / 100);
      sumExcl += lineExcl;
      if (rate > 0) vatGroups[rate] = (vatGroups[rate] || 0) + lineVat;
      tr.querySelector(".line-sum").textContent = fmtMoney(lineExcl);
    });

    var rates = Object.keys(vatGroups).sort(function (a, b) { return b - a; });
    var sumVat = rates.reduce(function (sum, r) { return sum + vatGroups[r]; }, 0);
    var total = sumExcl + sumVat;

    var html = '<div class="totals-row"><span>Sum eks. mva</span><span>' + fmtMoney(sumExcl) + "</span></div>";
    rates.forEach(function (rate) {
      html += '<div class="totals-row"><span>MVA ' + rate + "%</span><span>" + fmtMoney(vatGroups[rate]) + "</span></div>";
    });
    html += '<div class="totals-row total"><span>Totalt å betale</span><span>' + fmtMoney(total) + "</span></div>";
    totalsBox.innerHTML = html;
  }

  // ---------- persistence ----------

  function collectState() {
    var fields = {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-field]"), function (el) {
      fields[el.getAttribute("data-field")] = el.value;
    });
    return { fields: fields, items: readItems(), mva: mvaCheckbox.checked };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
    } catch (e) {
      /* storage unavailable (private mode / quota) - draft just won't persist */
    }
  }

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }

    var data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = null;
      }
    }

    if (data && data.fields) {
      Object.keys(data.fields).forEach(function (key) {
        var el = document.querySelector('[data-field="' + key + '"]');
        if (el) el.value = data.fields[key];
      });
      mvaCheckbox.checked = data.mva !== false;
      (data.items && data.items.length ? data.items : [null]).forEach(addRow);
      return;
    }

    var today = todayISO();
    document.querySelector('[data-field="meta.invoiceDate"]').value = today;
    document.querySelector('[data-field="meta.dueDate"]').value = addDaysISO(today, 14);
    document.querySelector('[data-field="meta.terms"]').value = "14 dager netto";
    addRow(null);
  }

  // ---------- events ----------

  document.addEventListener("input", function (e) {
    if (!e.target.matches("[data-field], [data-item]")) return;
    if (e.target.matches("[data-item]")) recalc();
    save();
  });

  mvaCheckbox.addEventListener("change", function () {
    recalc();
    save();
  });

  document.getElementById("add-row").addEventListener("click", function () {
    addRow(null);
    save();
  });

  itemsBody.addEventListener("click", function (e) {
    var btn = e.target.closest(".del-row");
    if (btn) removeRow(btn.closest("tr"));
  });

  document.getElementById("print-btn").addEventListener("click", function () {
    window.print();
  });

  document.getElementById("reset-btn").addEventListener("click", function () {
    if (!window.confirm("Nullstille fakturaen? Utkastet i denne nettleseren blir slettet.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    location.reload();
  });

  load();
})();
