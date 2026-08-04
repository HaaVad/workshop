// Shared storage + formula logic for the tracker project and its admin page.
// Attaches a single `TrackerStore` global so both /tracker/ and /tracker/admin/
// can load it with a plain <script> tag (no build step, no modules).
(function () {
  "use strict";

  var TYPES_KEY = "tracker.v1.types";
  var ENTRIES_KEY = "tracker.v1.entries";

  // ---------- low-level storage ----------

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // storage unavailable (private mode / quota) - changes just won't persist
      return false;
    }
  }

  function getTypes() {
    return readJson(TYPES_KEY, []);
  }

  function saveTypes(types) {
    return writeJson(TYPES_KEY, types);
  }

  function getEntriesByType() {
    return readJson(ENTRIES_KEY, {});
  }

  function saveEntriesByType(entriesByType) {
    return writeJson(ENTRIES_KEY, entriesByType);
  }

  function getEntries(typeId) {
    var all = getEntriesByType();
    return all[typeId] || [];
  }

  function randomId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // ---------- slug helper (used for auto-generating field/type keys) ----------

  function slugify(label) {
    var slug = String(label)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!slug) slug = "field";
    if (/^[0-9]/.test(slug)) slug = "f_" + slug;
    return slug;
  }

  function uniqueKey(base, taken) {
    var key = base;
    var n = 2;
    while (taken.indexOf(key) !== -1) {
      key = base + "_" + n;
      n++;
    }
    return key;
  }

  // ---------- types CRUD ----------

  function addType(type) {
    var types = getTypes();
    types.push(type);
    saveTypes(types);
    return type;
  }

  function updateType(typeId, updatedType) {
    var types = getTypes();
    var idx = types.findIndex(function (t) { return t.id === typeId; });
    if (idx === -1) return false;
    types[idx] = updatedType;
    saveTypes(types);
    return true;
  }

  function deleteType(typeId) {
    var types = getTypes().filter(function (t) { return t.id !== typeId; });
    saveTypes(types);
    var entriesByType = getEntriesByType();
    delete entriesByType[typeId];
    saveEntriesByType(entriesByType);
  }

  function getType(typeId) {
    return getTypes().find(function (t) { return t.id === typeId; }) || null;
  }

  // ---------- entries ----------

  function addEntry(typeId, values) {
    var entriesByType = getEntriesByType();
    var list = entriesByType[typeId] || [];
    var entry = { id: randomId(), ts: Date.now(), values: values };
    list.push(entry);
    entriesByType[typeId] = list;
    saveEntriesByType(entriesByType);
    return entry;
  }

  function deleteEntry(typeId, entryId) {
    var entriesByType = getEntriesByType();
    var list = entriesByType[typeId] || [];
    entriesByType[typeId] = list.filter(function (e) { return e.id !== entryId; });
    saveEntriesByType(entriesByType);
  }

  function getTotals(typeId, fields) {
    var entries = getEntries(typeId);
    var totals = {};
    fields.forEach(function (f) { totals[f.key] = 0; });
    entries.forEach(function (entry) {
      fields.forEach(function (f) {
        var v = Number(entry.values[f.key]);
        if (!isNaN(v)) totals[f.key] += v;
      });
    });
    return totals;
  }

  // ---------- safe arithmetic formula evaluator ----------
  // Supports + - * / ( ) unary minus, decimal numbers, and bare identifiers
  // resolved from a variables map. Deliberately avoids eval()/Function() so
  // a formula can never run arbitrary JS - it can only add/subtract/
  // multiply/divide known numbers.

  function tokenize(expr) {
    var tokens = [];
    var i = 0;
    while (i < expr.length) {
      var c = expr[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var start = i;
        while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
        tokens.push({ type: "num", value: parseFloat(expr.slice(start, i)) });
        continue;
      }
      if (/[a-zA-Z_]/.test(c)) {
        var s = i;
        while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) i++;
        tokens.push({ type: "id", value: expr.slice(s, i) });
        continue;
      }
      if ("+-*/()".indexOf(c) !== -1) {
        tokens.push({ type: c });
        i++;
        continue;
      }
      throw new Error('Unexpected character "' + c + '" in formula');
    }
    return tokens;
  }

  function parseExpression(tokens, vars) {
    var pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parsePrimary() {
      var t = peek();
      if (!t) throw new Error("Unexpected end of formula");
      if (t.type === "num") { next(); return t.value; }
      if (t.type === "id") {
        next();
        if (!Object.prototype.hasOwnProperty.call(vars, t.value)) {
          throw new Error('Unknown variable "' + t.value + '"');
        }
        return Number(vars[t.value]) || 0;
      }
      if (t.type === "(") {
        next();
        var v = parseAddSub();
        if (!peek() || peek().type !== ")") throw new Error('Expected ")"');
        next();
        return v;
      }
      if (t.type === "-") {
        next();
        return -parsePrimary();
      }
      if (t.type === "+") {
        next();
        return parsePrimary();
      }
      throw new Error("Unexpected token in formula");
    }

    function parseMulDiv() {
      var v = parsePrimary();
      while (peek() && (peek().type === "*" || peek().type === "/")) {
        var op = next().type;
        var rhs = parsePrimary();
        v = op === "*" ? v * rhs : v / rhs;
      }
      return v;
    }

    function parseAddSub() {
      var v = parseMulDiv();
      while (peek() && (peek().type === "+" || peek().type === "-")) {
        var op = next().type;
        var rhs = parseMulDiv();
        v = op === "+" ? v + rhs : v - rhs;
      }
      return v;
    }

    var result = parseAddSub();
    if (pos < tokens.length) throw new Error("Unexpected trailing input in formula");
    return result;
  }

  function evaluateFormula(formula, vars) {
    var tokens = tokenize(formula || "0");
    return parseExpression(tokens, vars || {});
  }

  window.TrackerStore = {
    getTypes: getTypes,
    saveTypes: saveTypes,
    getType: getType,
    addType: addType,
    updateType: updateType,
    deleteType: deleteType,
    getEntries: getEntries,
    addEntry: addEntry,
    deleteEntry: deleteEntry,
    getTotals: getTotals,
    slugify: slugify,
    uniqueKey: uniqueKey,
    randomId: randomId,
    evaluateFormula: evaluateFormula,
  };
})();
