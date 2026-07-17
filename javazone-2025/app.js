(function () {
  "use strict";

  var DATA_URL = "https://sleepingpill.javazone.no/public/allSessions/javazone_2025";
  var CACHE_KEY = "jz2025-cache-v1";
  var FAV_KEY = "jz2025-favorites-v1";

  var els = {
    content: document.getElementById("content"),
    dayTabs: document.getElementById("day-tabs"),
    filterPanel: document.getElementById("filter-panel"),
    filterToggle: document.getElementById("filter-toggle"),
    filterCount: document.getElementById("filter-count"),
    search: document.getElementById("search-input"),
    favCount: document.getElementById("fav-count"),
    viewTabs: document.querySelectorAll(".view-tab"),
  };

  var state = {
    sessions: [],
    loadError: null,
    favorites: loadFavorites(),
    view: "schedule", // 'schedule' | 'my-schedule'
    filterPanelOpen: false,
    filters: {
      query: "",
      day: "all",
      formats: new Set(),
      rooms: new Set(),
      keywords: new Set(),
      languages: new Set(),
      levels: new Set(),
    },
  };

  // ---------- storage helpers ----------

  function loadFavorites() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(state.favorites)));
    } catch (e) {
      /* storage unavailable (private mode / quota) - favorites just won't persist */
    }
  }

  // ---------- data normalization ----------

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj ? obj[keys[i]] : undefined;
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  }

  function asString(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") return value.name || value.title || value.label || "";
    return String(value);
  }

  function randomId() {
    return "id-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
  }

  function extractSessions(json) {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.sessions)) return json.sessions;
    if (json) {
      for (var key in json) {
        if (Object.prototype.hasOwnProperty.call(json, key) && Array.isArray(json[key])) {
          return json[key];
        }
      }
    }
    return [];
  }

  function normalizeSession(raw) {
    var startRaw = pick(raw, ["startTimeZulu", "startTime", "start", "startSlot", "startTimeUtc"]);
    var endRaw = pick(raw, ["endTimeZulu", "endTime", "end", "endSlot", "endTimeUtc"]);
    var start = startRaw ? new Date(startRaw) : null;
    var end = endRaw ? new Date(endRaw) : null;
    var lengthMin = pick(raw, ["lengthInMinutes", "length", "durationInMinutes"]);
    if (start && !end && lengthMin) {
      end = new Date(start.getTime() + Number(lengthMin) * 60000);
    }
    if (start && isNaN(start.getTime())) start = null;
    if (end && isNaN(end.getTime())) end = null;

    var speakersRaw = raw.speakers || raw.speaker || [];
    if (!Array.isArray(speakersRaw)) speakersRaw = [speakersRaw];
    var speakers = speakersRaw.map(function (sp) {
      if (typeof sp === "string") return { name: sp, bio: "" };
      return {
        name: pick(sp, ["name", "fullName", "displayName"]) || "Unknown speaker",
        bio: pick(sp, ["bio", "biography"]) || "",
      };
    });

    var keywordsRaw = pick(raw, ["keywords", "tags", "topics"]) || [];
    if (!Array.isArray(keywordsRaw)) keywordsRaw = [keywordsRaw];
    var keywords = keywordsRaw.map(asString).filter(Boolean);

    var id = raw.id || raw.sessionId || raw.uuid || randomId();

    return {
      id: String(id),
      title: pick(raw, ["title", "name"]) || "Untitled session",
      abstract: pick(raw, ["abstract", "summary", "body", "description"]) || "",
      room: asString(pick(raw, ["room", "roomName"])) || "TBA",
      format: asString(pick(raw, ["format", "sessionFormat", "type"])) || "",
      level: asString(pick(raw, ["level", "intendedAudience"])) || "",
      language: asString(pick(raw, ["language", "lang"])) || "",
      keywords: keywords,
      speakers: speakers,
      start: start,
      end: end,
      dayKey: start ? dayKey(start) : "unknown",
    };
  }

  function dayKey(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatDayLabel(key) {
    if (key === "unknown") return "Unscheduled";
    var parts = key.split("-").map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function formatTime(date) {
    if (!date) return "?";
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  // ---------- fetch ----------

  function loadSessions() {
    setStatus("Loading program…");
    fetch(DATA_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(json));
        } catch (e) { /* ignore quota errors */ }
        applySessions(json);
      })
      .catch(function (err) {
        console.warn("Live fetch failed, falling back to cache", err);
        var cached = null;
        try {
          var raw = localStorage.getItem(CACHE_KEY);
          cached = raw ? JSON.parse(raw) : null;
        } catch (e) { /* ignore */ }
        if (cached) {
          applySessions(cached);
          state.loadError = "Showing the last loaded program — couldn't reach the live schedule just now.";
          render();
        } else {
          state.loadError = "Couldn't load the program (network error) and no cached copy is available yet.";
          render();
        }
      });
  }

  function applySessions(json) {
    state.sessions = extractSessions(json).map(normalizeSession);
    state.loadError = null;
    render();
  }

  function setStatus(text) {
    els.content.innerHTML = '<p class="status">' + escapeHtml(text) + "</p>";
  }

  // ---------- filtering ----------

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getFacets() {
    var facets = { formats: new Set(), rooms: new Set(), keywords: new Set(), languages: new Set(), levels: new Set() };
    state.sessions.forEach(function (s) {
      if (s.format) facets.formats.add(s.format);
      if (s.room) facets.rooms.add(s.room);
      if (s.language) facets.languages.add(s.language);
      if (s.level) facets.levels.add(s.level);
      s.keywords.forEach(function (k) { facets.keywords.add(k); });
    });
    return facets;
  }

  function getDays() {
    var days = new Set();
    state.sessions.forEach(function (s) { days.add(s.dayKey); });
    return Array.from(days).sort();
  }

  function matchesFilters(s) {
    var f = state.filters;
    var favoritesOnly = state.view === "my-schedule";

    if (favoritesOnly && !state.favorites.has(s.id)) return false;
    if (f.day !== "all" && s.dayKey !== f.day) return false;
    if (f.formats.size && !f.formats.has(s.format)) return false;
    if (f.rooms.size && !f.rooms.has(s.room)) return false;
    if (f.languages.size && !f.languages.has(s.language)) return false;
    if (f.levels.size && !f.levels.has(s.level)) return false;
    if (f.keywords.size) {
      var hasKeyword = s.keywords.some(function (k) { return f.keywords.has(k); });
      if (!hasKeyword) return false;
    }
    if (f.query) {
      var haystack = (
        s.title + " " + s.abstract + " " + s.room + " " + s.keywords.join(" ") + " " +
        s.speakers.map(function (sp) { return sp.name; }).join(" ")
      ).toLowerCase();
      if (haystack.indexOf(f.query.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function activeFilterCount() {
    var f = state.filters;
    return f.formats.size + f.rooms.size + f.keywords.size + f.languages.size + f.levels.size + (f.day !== "all" ? 0 : 0);
  }

  function computeConflicts() {
    var favSessions = state.sessions.filter(function (s) { return state.favorites.has(s.id) && s.start && s.end; });
    var conflicts = new Set();
    for (var i = 0; i < favSessions.length; i++) {
      for (var j = i + 1; j < favSessions.length; j++) {
        var a = favSessions[i], b = favSessions[j];
        if (a.start < b.end && b.start < a.end) {
          conflicts.add(a.id);
          conflicts.add(b.id);
        }
      }
    }
    return conflicts;
  }

  // ---------- rendering ----------

  function render() {
    renderViewTabs();
    renderDayTabs();
    renderFilterPanel();
    renderFavCount();
    renderContent();
  }

  function renderViewTabs() {
    els.viewTabs.forEach(function (btn) {
      var active = btn.dataset.view === state.view;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function renderFavCount() {
    els.favCount.textContent = String(state.favorites.size);
  }

  function renderDayTabs() {
    var days = getDays();
    if (days.length < 2) {
      els.dayTabs.hidden = true;
      els.dayTabs.innerHTML = "";
      return;
    }
    els.dayTabs.hidden = false;
    var buttons = ['<button class="day-tab' + (state.filters.day === "all" ? " active" : "") + '" data-day="all" type="button">All days</button>'];
    days.forEach(function (d) {
      buttons.push(
        '<button class="day-tab' + (state.filters.day === d ? " active" : "") + '" data-day="' + escapeHtml(d) + '" type="button">' +
        escapeHtml(formatDayLabel(d)) + "</button>"
      );
    });
    els.dayTabs.innerHTML = buttons.join("");
  }

  function renderFilterGroup(title, key, values) {
    if (!values.length) return "";
    var f = state.filters[key];
    var chips = values
      .sort(function (a, b) { return a.localeCompare(b); })
      .map(function (v) {
        var active = f.has(v);
        return '<button class="chip' + (active ? " active" : "") + '" type="button" data-filter-key="' + key + '" data-filter-value="' +
          escapeHtml(v) + '">' + escapeHtml(v) + "</button>";
      })
      .join("");
    return '<div class="filter-group"><h3>' + escapeHtml(title) + '</h3><div class="chip-row">' + chips + "</div></div>";
  }

  function renderFilterPanel() {
    els.filterPanel.hidden = !state.filterPanelOpen;
    els.filterToggle.setAttribute("aria-expanded", state.filterPanelOpen ? "true" : "false");

    var count = activeFilterCount();
    els.filterCount.textContent = String(count);
    els.filterCount.classList.toggle("hidden", count === 0);

    if (!state.filterPanelOpen) return;

    var facets = getFacets();
    var html = "";
    html += renderFilterGroup("Format", "formats", Array.from(facets.formats));
    html += renderFilterGroup("Level", "levels", Array.from(facets.levels));
    html += renderFilterGroup("Language", "languages", Array.from(facets.languages));
    html += renderFilterGroup("Room", "rooms", Array.from(facets.rooms));
    html += renderFilterGroup("Topic", "keywords", Array.from(facets.keywords));
    html += '<div class="filter-actions"><button class="link-btn" type="button" id="clear-filters">Clear all filters</button></div>';
    els.filterPanel.innerHTML = html;
  }

  function renderSessionCard(s, conflicts) {
    var isFav = state.favorites.has(s.id);
    var isConflict = conflicts.has(s.id);
    var speakerNames = s.speakers.map(function (sp) { return sp.name; }).join(", ");
    var timeRange = s.start ? formatTime(s.start) + (s.end ? "–" + formatTime(s.end) : "") : "Time TBA";

    var meta = [];
    meta.push('<span>' + escapeHtml(timeRange) + "</span>");
    if (s.room) meta.push("<span>" + escapeHtml(s.room) + "</span>");
    if (s.format) meta.push("<span>" + escapeHtml(s.format) + "</span>");
    if (s.level) meta.push("<span>" + escapeHtml(s.level) + "</span>");
    if (isConflict) meta.push('<span class="conflict-tag">⚠ overlaps another favorite</span>');

    var tags = s.keywords.map(function (k) { return '<span class="tag">' + escapeHtml(k) + "</span>"; }).join("");

    return (
      '<article class="session-card' + (isConflict ? " is-conflict" : "") + '" data-id="' + escapeHtml(s.id) + '">' +
        '<div class="session-top">' +
          '<h3 class="session-title" data-action="toggle-abstract">' + escapeHtml(s.title) + "</h3>" +
          '<button class="fav-btn' + (isFav ? " is-fav" : "") + '" type="button" data-action="toggle-fav" aria-label="Toggle favorite" aria-pressed="' + isFav + '">' +
          (isFav ? "★" : "☆") + "</button>" +
        "</div>" +
        '<div class="session-meta">' + meta.join("") + "</div>" +
        (speakerNames ? '<div class="session-speakers">' + escapeHtml(speakerNames) + "</div>" : "") +
        (tags ? '<div class="tag-row">' + tags + "</div>" : "") +
        '<div class="session-abstract">' + escapeHtml(s.abstract || "No abstract provided.") + "</div>" +
      "</article>"
    );
  }

  function renderContent() {
    if (state.loadError && !state.sessions.length) {
      els.content.innerHTML =
        '<p class="status error">' + escapeHtml(state.loadError) + '</p>' +
        '<div style="text-align:center"><button class="retry-btn" type="button" id="retry-load">Retry</button></div>';
      return;
    }

    if (!state.sessions.length) {
      setStatus("Loading program…");
      return;
    }

    var filtered = state.sessions.filter(matchesFilters);
    var conflicts = computeConflicts();

    var banner = state.loadError
      ? '<p class="status error" style="padding:0.75rem 0;">' + escapeHtml(state.loadError) + "</p>"
      : "";

    if (!filtered.length) {
      els.content.innerHTML = banner + '<div class="empty-state">' + (
        state.view === "my-schedule"
          ? "No favorites yet. Tap the ☆ on any session to add it to your schedule."
          : "No sessions match your filters."
      ) + "</div>";
      return;
    }

    filtered.sort(function (a, b) {
      if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
      var at = a.start ? a.start.getTime() : Infinity;
      var bt = b.start ? b.start.getTime() : Infinity;
      return at - bt;
    });

    var groupedByDay = {};
    var dayOrder = [];
    filtered.forEach(function (s) {
      if (!groupedByDay[s.dayKey]) {
        groupedByDay[s.dayKey] = {};
        dayOrder.push(s.dayKey);
      }
      var timeLabel = s.start ? formatTime(s.start) : "Time TBA";
      if (!groupedByDay[s.dayKey][timeLabel]) groupedByDay[s.dayKey][timeLabel] = [];
      groupedByDay[s.dayKey][timeLabel].push(s);
    });

    var html = banner;
    dayOrder.forEach(function (dKey) {
      if (state.filters.day === "all" && dayOrder.length > 1) {
        html += '<h2 class="day-heading">' + escapeHtml(formatDayLabel(dKey)) + "</h2>";
      }
      var slots = groupedByDay[dKey];
      Object.keys(slots).forEach(function (timeLabel) {
        html += '<h3 class="time-heading">' + escapeHtml(timeLabel) + "</h3>";
        html += '<div class="session-grid">';
        slots[timeLabel].forEach(function (s) {
          html += renderSessionCard(s, conflicts);
        });
        html += "</div>";
      });
    });

    els.content.innerHTML = html;
  }

  // ---------- events ----------

  els.viewTabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.view = btn.dataset.view;
      render();
    });
  });

  els.filterToggle.addEventListener("click", function () {
    state.filterPanelOpen = !state.filterPanelOpen;
    renderFilterPanel();
  });

  els.dayTabs.addEventListener("click", function (e) {
    var btn = e.target.closest(".day-tab");
    if (!btn) return;
    state.filters.day = btn.dataset.day;
    render();
  });

  els.filterPanel.addEventListener("click", function (e) {
    if (e.target.id === "clear-filters") {
      state.filters.formats.clear();
      state.filters.rooms.clear();
      state.filters.keywords.clear();
      state.filters.languages.clear();
      state.filters.levels.clear();
      render();
      return;
    }
    var chip = e.target.closest(".chip");
    if (!chip) return;
    var key = chip.dataset.filterKey;
    var value = chip.dataset.filterValue;
    var set = state.filters[key];
    if (set.has(value)) set.delete(value); else set.add(value);
    render();
  });

  var searchDebounce;
  els.search.addEventListener("input", function () {
    clearTimeout(searchDebounce);
    var value = els.search.value;
    searchDebounce = setTimeout(function () {
      state.filters.query = value.trim();
      renderContent();
      var count = activeFilterCount();
      els.filterCount.textContent = String(count);
      els.filterCount.classList.toggle("hidden", count === 0);
    }, 150);
  });

  els.content.addEventListener("click", function (e) {
    if (e.target.id === "retry-load") {
      loadSessions();
      return;
    }
    var favBtn = e.target.closest('[data-action="toggle-fav"]');
    if (favBtn) {
      var card = favBtn.closest(".session-card");
      var id = card.dataset.id;
      if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
      saveFavorites();
      render();
      return;
    }
    var title = e.target.closest('[data-action="toggle-abstract"]');
    if (title) {
      title.closest(".session-card").classList.toggle("expanded");
    }
  });

  loadSessions();
})();
