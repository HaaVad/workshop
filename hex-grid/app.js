(() => {
  "use strict";

  const svg = document.getElementById("grid");
  const layer = document.getElementById("hexes");
  const SVGNS = "http://www.w3.org/2000/svg";

  // Flat-top hex radius (center to corner), in px. Smaller on phones so more
  // of the "infinite" grid is visible.
  let HEX_SIZE, HEX_W, HEX_H;

  function computeHexSize() {
    HEX_SIZE = Math.max(30, Math.min(46, Math.min(window.innerWidth, window.innerHeight) / 9));
    HEX_W = HEX_SIZE * 2;
    HEX_H = Math.sqrt(3) * HEX_SIZE;
  }

  let hexes = new Map(); // "q,r" -> { q, r, el, cx, cy, hover }
  let hovered = null;

  function key(q, r) {
    return q + "," + r;
  }

  function axialToPixel(q, r) {
    return {
      x: HEX_SIZE * 1.5 * q,
      y: HEX_H * (r + q / 2),
    };
  }

  function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
  }

  function hexPoints(cx, cy) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i);
      pts.push((cx + HEX_SIZE * Math.cos(angle)).toFixed(2) + "," + (cy + HEX_SIZE * Math.sin(angle)).toFixed(2));
    }
    return pts.join(" ");
  }

  function buildGrid() {
    computeHexSize();
    layer.innerHTML = "";
    hexes = new Map();
    hovered = null;

    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const cx0 = w / 2;
    const cy0 = h / 2;

    // Buffer of one hex beyond the viewport so edge hexes are visibly cut
    // off, reinforcing the "grid stretches on forever" illusion.
    const bufX = HEX_W;
    const bufY = HEX_H;

    const qMax = Math.ceil((w / 2 + bufX) / (HEX_SIZE * 1.5)) + 1;
    const rMax = Math.ceil((h / 2 + bufY) / HEX_H) + qMax + 1;

    const frag = document.createDocumentFragment();

    for (let q = -qMax; q <= qMax; q++) {
      for (let r = -rMax; r <= rMax; r++) {
        const { x, y } = axialToPixel(q, r);
        const cx = cx0 + x;
        const cy = cy0 + y;

        if (
          cx < -bufX || cx > w + bufX ||
          cy < -bufY || cy > h + bufY
        ) {
          continue;
        }

        const poly = document.createElementNS(SVGNS, "polygon");
        poly.setAttribute("points", hexPoints(cx, cy));
        poly.setAttribute("class", "hex");
        poly.dataset.q = q;
        poly.dataset.r = r;
        poly.style.setProperty("--flicker-delay", (Math.random() * 6).toFixed(2));

        const entry = { q, r, el: poly, cx, cy, hover: 0 };
        hexes.set(key(q, r), entry);
        frag.appendChild(poly);
      }
    }

    layer.appendChild(frag);
  }

  // --- Interaction: touched hex + immediate neighbors enlarge ---

  const HOVER_SCALE = [0.24, 0.11, 0.03]; // distance 0, 1, 2 -> extra scale

  function scaleForDistance(d) {
    if (d < HOVER_SCALE.length) return HOVER_SCALE[d];
    return 0;
  }

  function setHover(q, r) {
    clearHover();
    hovered = key(q, r);
    for (const entry of hexes.values()) {
      const d = hexDistance(q, r, entry.q, entry.r);
      entry.hover = scaleForDistance(d);
      if (d === 0) entry.el.classList.add("active");
    }
    if (!rippleRunning) applyStaticTransforms();
  }

  function clearHover() {
    if (hovered === null) return;
    for (const entry of hexes.values()) {
      entry.hover = 0;
      entry.el.classList.remove("active");
    }
    hovered = null;
    if (!rippleRunning) applyStaticTransforms();
  }

  function applyStaticTransforms() {
    for (const entry of hexes.values()) {
      const s = 1 + entry.hover;
      entry.el.style.transform = s === 1 ? "" : `scale(${s.toFixed(3)})`;
    }
  }

  // --- Ripple wave: an expanding, decaying pulse radiating from the tap ---

  const ripples = [];
  let rippleRunning = false;
  const SPEED = 9; // hex rings per second
  const SIGMA = 0.65;
  const AMPLITUDE = 0.3;
  const DIST_DECAY = 0.12;
  const TIME_DECAY = 0.9; // seconds, exponential decay tau
  const MAX_LIFE = 2.2; // seconds

  function spawnRipple(q, r) {
    ripples.push({ q, r, start: performance.now() });
    if (ripples.length > 6) ripples.shift();
    if (!rippleRunning) {
      rippleRunning = true;
      requestAnimationFrame(rippleTick);
    }
  }

  function rippleTick(now) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      if ((now - ripples[i].start) / 1000 > MAX_LIFE) ripples.splice(i, 1);
    }

    if (ripples.length === 0) {
      rippleRunning = false;
      applyStaticTransforms();
      return;
    }

    for (const entry of hexes.values()) {
      let extra = 0;
      for (const ripple of ripples) {
        const t = (now - ripple.start) / 1000;
        const dist = hexDistance(ripple.q, ripple.r, entry.q, entry.r);
        const front = t * SPEED;
        const phase = front - dist;
        const gaussian = Math.exp(-(phase * phase) / (2 * SIGMA * SIGMA));
        const decay = Math.exp(-t / TIME_DECAY) * Math.exp(-dist * DIST_DECAY);
        extra += AMPLITUDE * decay * gaussian;
      }
      const s = 1 + entry.hover + extra;
      entry.el.style.transform = s <= 1.001 ? "" : `scale(${s.toFixed(3)})`;
    }

    requestAnimationFrame(rippleTick);
  }

  // --- Pointer wiring ---

  function hexFromEvent(e) {
    const el = e.target.closest ? e.target.closest(".hex") : null;
    if (!el) return null;
    return { q: Number(el.dataset.q), r: Number(el.dataset.r) };
  }

  layer.addEventListener("pointerdown", (e) => {
    const hit = hexFromEvent(e);
    if (!hit) return;
    setHover(hit.q, hit.r);
    spawnRipple(hit.q, hit.r);
  });

  layer.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const hit = hexFromEvent(e);
    if (hit) setHover(hit.q, hit.r);
  });

  layer.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") return;
    const hit = hexFromEvent(e);
    if (hit) setHover(hit.q, hit.r);
  });

  window.addEventListener("pointerup", clearHover);
  window.addEventListener("pointercancel", clearHover);
  svg.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") clearHover();
  });

  // --- Resize handling ---

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildGrid, 150);
  });

  buildGrid();
})();
