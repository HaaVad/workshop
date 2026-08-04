(function () {
  "use strict";

  var Store = window.TrackerStore;
  var content = document.getElementById("content");

  var state = {
    editingId: null, // null = not editing, "new" = creating, else = existing type id
    draft: null, // { name, fields: [{label,key}], constants: [{label,key,value}], formula, resultLabel }
    error: null,
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function emptyDraft() {
    return {
      name: "",
      fields: [{ label: "", key: "" }],
      constants: [],
      formula: "",
      resultLabel: "",
    };
  }

  function draftFromType(type) {
    return {
      name: type.name,
      fields: type.fields.map(function (f) { return { label: f.label, key: f.key }; }),
      constants: (type.constants || []).map(function (c) { return { label: c.label, key: c.key, value: c.value }; }),
      formula: type.formula,
      resultLabel: type.resultLabel || "",
    };
  }

  // ---------- rendering ----------

  function renderList() {
    var types = Store.getTypes();
    if (!types.length) {
      return '<div class="empty-state">No trackers defined yet. Create one below.</div>';
    }
    return '<div class="admin-list">' + types.map(function (t) {
      return (
        '<div class="admin-item">' +
          '<div>' +
            '<div class="name">' + escapeHtml(t.name) + "</div>" +
            '<div class="meta">' + t.fields.length + " field(s), formula: " + escapeHtml(t.formula) + "</div>" +
          "</div>" +
          '<div class="actions">' +
            '<button class="btn btn-sm" type="button" data-action="edit-type" data-type-id="' + escapeHtml(t.id) + '">edit</button>' +
            '<button class="btn btn-sm btn-danger" type="button" data-action="delete-type" data-type-id="' + escapeHtml(t.id) + '">delete</button>' +
          "</div>" +
        "</div>"
      );
    }).join("") + "</div>";
  }

  function renderRepeatableRow(kind, index, item) {
    var valueInput = kind === "constant"
      ? '<input type="number" step="any" data-role="value" data-kind="' + kind + '" data-index="' + index + '" placeholder="value" value="' + escapeHtml(item.value === undefined ? "" : item.value) + '">'
      : "";
    return (
      '<div class="repeatable-row">' +
        '<input type="text" data-role="label" data-kind="' + kind + '" data-index="' + index + '" placeholder="Label (e.g. Trips)" value="' + escapeHtml(item.label) + '">' +
        valueInput +
        '<button class="btn btn-sm btn-danger" type="button" data-action="remove-' + kind + '" data-index="' + index + '">×</button>' +
      "</div>"
    );
  }

  function renderForm() {
    var d = state.draft;
    var isEditing = state.editingId !== "new";
    var fieldKeys = d.fields.map(function (f) { return f.key || Store.slugify(f.label); });
    var constantKeys = d.constants.map(function (c) { return c.key || Store.slugify(c.label); });
    var availableVars = fieldKeys.concat(constantKeys).filter(Boolean);

    return (
      '<div class="form-card">' +
        "<h2>" + (isEditing ? "Edit tracker" : "New tracker") + "</h2>" +
        '<div class="form-row">' +
          '<label for="type-name">Name</label>' +
          '<input type="text" id="type-name" data-role="name" value="' + escapeHtml(d.name) + '" placeholder="e.g. Bike trips">' +
        "</div>" +

        '<div class="section-label">Fields (things you log a number for)</div>' +
        d.fields.map(function (f, i) { return renderRepeatableRow("field", i, f); }).join("") +
        '<button class="btn btn-sm" type="button" data-action="add-field">+ add field</button>' +

        '<div class="section-label">Constants (fixed values, e.g. a ticket price)</div>' +
        (d.constants.length ? d.constants.map(function (c, i) { return renderRepeatableRow("constant", i, c); }).join("") : '<p class="form-hint">None yet.</p>') +
        '<button class="btn btn-sm" type="button" data-action="add-constant">+ add constant</button>' +

        '<div class="form-row" style="margin-top: 1.1rem;">' +
          '<label for="type-formula">Result formula</label>' +
          '<input type="text" id="type-formula" data-role="formula" value="' + escapeHtml(d.formula) + '" placeholder="e.g. trips * ticket_price">' +
          '<span class="form-hint">Available variables: ' + (availableVars.length ? availableVars.map(escapeHtml).join(", ") : "(add a field or constant first)") + '. Supports + - * / and parentheses.</span>' +
        "</div>" +
        '<div class="form-row">' +
          '<label for="type-result-label">Result label</label>' +
          '<input type="text" id="type-result-label" data-role="result-label" value="' + escapeHtml(d.resultLabel) + '" placeholder="e.g. kr saved">' +
        "</div>" +

        (state.error ? '<p class="form-error">' + escapeHtml(state.error) + "</p>" : "") +

        '<div class="form-actions">' +
          '<button class="btn btn-primary" type="button" data-action="save-type">Save</button>' +
          '<button class="btn" type="button" data-action="cancel-edit">Cancel</button>' +
        "</div>" +
      "</div>"
    );
  }

  function render() {
    var html = renderList();
    if (state.editingId) {
      html += renderForm();
    } else {
      html += '<button class="btn btn-primary" type="button" data-action="new-type">+ new tracker</button>';
    }
    content.innerHTML = html;
  }

  // ---------- draft mutation helpers ----------

  function syncDraftFromInputs() {
    var d = state.draft;
    var nameInput = content.querySelector('[data-role="name"]');
    if (nameInput) d.name = nameInput.value;
    var formulaInput = content.querySelector('[data-role="formula"]');
    if (formulaInput) d.formula = formulaInput.value;
    var resultLabelInput = content.querySelector('[data-role="result-label"]');
    if (resultLabelInput) d.resultLabel = resultLabelInput.value;

    content.querySelectorAll('[data-kind="field"][data-role="label"]').forEach(function (input) {
      var i = Number(input.dataset.index);
      if (d.fields[i]) d.fields[i].label = input.value;
    });
    content.querySelectorAll('[data-kind="constant"][data-role="label"]').forEach(function (input) {
      var i = Number(input.dataset.index);
      if (d.constants[i]) d.constants[i].label = input.value;
    });
    content.querySelectorAll('[data-kind="constant"][data-role="value"]').forEach(function (input) {
      var i = Number(input.dataset.index);
      if (d.constants[i]) d.constants[i].value = input.value;
    });
  }

  // ---------- validation + save ----------

  function buildTypeFromDraft(existingId) {
    var d = state.draft;
    var name = d.name.trim();
    if (!name) throw new Error("Name is required.");

    var fieldKeysSoFar = [];
    var fields = d.fields
      .filter(function (f) { return f.label.trim(); })
      .map(function (f) {
        var key = f.key && f.key.trim() ? f.key.trim() : Store.uniqueKey(Store.slugify(f.label), fieldKeysSoFar);
        fieldKeysSoFar.push(key);
        return { key: key, label: f.label.trim() };
      });
    if (!fields.length) throw new Error("Add at least one field.");

    var constants = d.constants
      .filter(function (c) { return c.label.trim(); })
      .map(function (c) {
        var key = c.key && c.key.trim() ? c.key.trim() : Store.uniqueKey(Store.slugify(c.label), fieldKeysSoFar);
        fieldKeysSoFar.push(key);
        var value = Number(c.value);
        if (isNaN(value)) throw new Error('Constant "' + c.label + '" needs a numeric value.');
        return { key: key, label: c.label.trim(), value: value };
      });

    var formula = d.formula.trim();
    if (!formula) throw new Error("Result formula is required.");

    var testVars = {};
    fields.forEach(function (f) { testVars[f.key] = 1; });
    constants.forEach(function (c) { testVars[c.key] = c.value; });
    try {
      Store.evaluateFormula(formula, testVars);
    } catch (e) {
      throw new Error("Formula error: " + e.message);
    }

    var resultLabel = d.resultLabel.trim();

    var existingTypes = Store.getTypes().filter(function (t) { return t.id !== existingId; });
    var id = existingId || Store.uniqueKey(Store.slugify(name), existingTypes.map(function (t) { return t.id; }));

    return { id: id, name: name, fields: fields, constants: constants, formula: formula, resultLabel: resultLabel };
  }

  function saveType() {
    syncDraftFromInputs();
    try {
      var isNew = state.editingId === "new";
      var existingId = isNew ? null : state.editingId;
      var type = buildTypeFromDraft(existingId);
      if (isNew) {
        Store.addType(type);
      } else {
        Store.updateType(existingId, type);
      }
      state.editingId = null;
      state.draft = null;
      state.error = null;
      render();
    } catch (e) {
      state.error = e.message;
      render();
    }
  }

  // ---------- events ----------

  content.addEventListener("click", function (e) {
    var target = e.target;

    if (target.closest('[data-action="new-type"]')) {
      state.editingId = "new";
      state.draft = emptyDraft();
      state.error = null;
      render();
      return;
    }

    var editBtn = target.closest('[data-action="edit-type"]');
    if (editBtn) {
      var type = Store.getType(editBtn.dataset.typeId);
      if (type) {
        state.editingId = type.id;
        state.draft = draftFromType(type);
        state.error = null;
        render();
      }
      return;
    }

    var deleteBtn = target.closest('[data-action="delete-type"]');
    if (deleteBtn) {
      var t = Store.getType(deleteBtn.dataset.typeId);
      if (t && window.confirm('Delete "' + t.name + '" and all its logged entries?')) {
        Store.deleteType(deleteBtn.dataset.typeId);
        render();
      }
      return;
    }

    if (target.closest('[data-action="cancel-edit"]')) {
      state.editingId = null;
      state.draft = null;
      state.error = null;
      render();
      return;
    }

    if (target.closest('[data-action="save-type"]')) {
      saveType();
      return;
    }

    if (target.closest('[data-action="add-field"]')) {
      syncDraftFromInputs();
      state.draft.fields.push({ label: "", key: "" });
      render();
      return;
    }

    if (target.closest('[data-action="add-constant"]')) {
      syncDraftFromInputs();
      state.draft.constants.push({ label: "", key: "", value: "" });
      render();
      return;
    }

    var removeField = target.closest('[data-action="remove-field"]');
    if (removeField) {
      syncDraftFromInputs();
      state.draft.fields.splice(Number(removeField.dataset.index), 1);
      render();
      return;
    }

    var removeConstant = target.closest('[data-action="remove-constant"]');
    if (removeConstant) {
      syncDraftFromInputs();
      state.draft.constants.splice(Number(removeConstant.dataset.index), 1);
      render();
      return;
    }
  });

  content.addEventListener("input", function (e) {
    if (e.target.dataset.role === "formula" || e.target.dataset.role === "name" || e.target.dataset.role === "result-label" ||
        e.target.dataset.role === "label" || e.target.dataset.role === "value") {
      syncDraftFromInputs();
    }
  });

  render();
})();
