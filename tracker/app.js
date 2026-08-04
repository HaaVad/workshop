(function () {
  "use strict";

  var Store = window.TrackerStore;
  var content = document.getElementById("content");

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatNumber(n) {
    if (!isFinite(n)) return "0";
    return Math.round(n * 100) / 100;
  }

  function formatTs(ts) {
    return new Date(ts).toLocaleString();
  }

  function computeResult(type, totals) {
    var vars = {};
    type.fields.forEach(function (f) { vars[f.key] = totals[f.key] || 0; });
    (type.constants || []).forEach(function (c) { vars[c.key] = Number(c.value) || 0; });
    try {
      return { value: Store.evaluateFormula(type.formula, vars), error: null };
    } catch (e) {
      return { value: null, error: e.message };
    }
  }

  function renderTrackerCard(type) {
    var totals = Store.getTotals(type.id, type.fields);
    var result = computeResult(type, totals);
    var entries = Store.getEntries(type.id).slice().sort(function (a, b) { return b.ts - a.ts; });

    var totalsHtml = type.fields.map(function (f) {
      return '<span>' + escapeHtml(f.label) + ": <strong>" + formatNumber(totals[f.key]) + "</strong></span>";
    }).join("");

    var constantsHtml = (type.constants || []).map(function (c) {
      return '<span>' + escapeHtml(c.label) + ": <strong>" + formatNumber(Number(c.value)) + "</strong></span>";
    }).join("");

    var resultHtml = result.error
      ? '<span class="value" style="color: var(--danger); font-size: 0.9rem;">Formula error: ' + escapeHtml(result.error) + "</span>"
      : '<span class="value">' + formatNumber(result.value) + '</span><span class="label">' + escapeHtml(type.resultLabel || "") + "</span>";

    var fieldsInputsHtml = type.fields.map(function (f) {
      return (
        '<div class="log-field">' +
          '<label for="log-' + escapeHtml(type.id) + "-" + escapeHtml(f.key) + '">' + escapeHtml(f.label) + "</label>" +
          '<input type="number" step="any" id="log-' + escapeHtml(type.id) + "-" + escapeHtml(f.key) + '" data-field-key="' + escapeHtml(f.key) + '" value="1">' +
        "</div>"
      );
    }).join("");

    var historyHtml = entries.length
      ? entries.slice(0, 20).map(function (e) {
          var valuesText = type.fields.map(function (f) {
            return escapeHtml(f.label) + " " + formatNumber(Number(e.values[f.key]) || 0);
          }).join(", ");
          return (
            '<div class="entry-row">' +
              '<span class="values">' + valuesText + "</span>" +
              '<span>' + escapeHtml(formatTs(e.ts)) + "</span>" +
              '<button class="btn btn-sm btn-danger" type="button" data-action="delete-entry" data-type-id="' + escapeHtml(type.id) + '" data-entry-id="' + escapeHtml(e.id) + '">delete</button>' +
            "</div>"
          );
        }).join("")
      : '<p class="form-hint">No entries logged yet.</p>';

    return (
      '<article class="tracker-card" data-type-id="' + escapeHtml(type.id) + '">' +
        '<div class="tracker-card-top"><h2>' + escapeHtml(type.name) + "</h2></div>" +
        '<div class="tracker-result">' + resultHtml + "</div>" +
        '<div class="field-totals">' + totalsHtml + constantsHtml + "</div>" +
        '<form class="log-form" data-action="log-entry" data-type-id="' + escapeHtml(type.id) + '">' +
          fieldsInputsHtml +
          '<button class="btn btn-primary" type="submit">Log entry</button>' +
        "</form>" +
        '<details class="entry-history"><summary>' + entries.length + " entries logged</summary>" + historyHtml + "</details>" +
      "</article>"
    );
  }

  function render() {
    var types = Store.getTypes();
    if (!types.length) {
      content.innerHTML = '<div class="empty-state">No trackers yet. Head to <a href="admin/">admin</a> to create one — e.g. track bike trips vs. bus tickets.</div>';
      return;
    }
    content.innerHTML = '<div class="tracker-grid">' + types.map(renderTrackerCard).join("") + "</div>";
  }

  content.addEventListener("submit", function (e) {
    var form = e.target.closest('[data-action="log-entry"]');
    if (!form) return;
    e.preventDefault();
    var typeId = form.dataset.typeId;
    var values = {};
    form.querySelectorAll("[data-field-key]").forEach(function (input) {
      values[input.dataset.fieldKey] = Number(input.value) || 0;
    });
    Store.addEntry(typeId, values);
    render();
  });

  content.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-action="delete-entry"]');
    if (!btn) return;
    Store.deleteEntry(btn.dataset.typeId, btn.dataset.entryId);
    render();
  });

  render();
})();
