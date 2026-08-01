// The situation map: a coarse world silhouette with every country plotted at
// its true position, zoomable, and recolourable by what you want to read.
//
// Colour encodings follow one rule each:
//   relations  diverging  — blue (allied) ↔ grey midpoint ↔ red (hostile)
//   power      sequential — one hue, five steps, low→high
//   stability  sequential — same ramp
//   blocs      categorical — three validated slots plus a neutral "non-aligned"
//   conflict   status      — reserved status colours, always paired with a ring
//
// Hover never draws over the map; it reports to the inspector panel instead.

import { LANDMASSES, OCEANS } from '../data/geography.js';
import { NATIONS_BY_ID } from '../data/nations.js';
import { blocsOf, defOf, getRelation, livePower, sovereignIds, sovereignStates } from '../engine/state.js';
import { areaOf, holders, outlineFor } from '../engine/territory.js';
import { t, tNation } from '../i18n/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 395; // 1000 * (LAT_TOP - LAT_BOTTOM) / 360 — true equirectangular
const LAT_TOP = 84;
const LAT_BOTTOM = -58;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export const VIEW_MODES = [
  { id: 'relations', name: 'Relations', hint: 'How each country feels about you.' },
  { id: 'power', name: 'Power', hint: 'Overall national power, low to high.' },
  { id: 'stability', name: 'Stability', hint: 'Institutional resilience, low to high.' },
  { id: 'blocs', name: 'Alignment', hint: 'Which way each country leans.' },
  { id: 'conflict', name: 'Conflict', hint: 'Who is fighting, and who is close to it.' },
];

/** Regions you can jump the camera to. */
export const MAP_FOCUSES = [
  { id: 'world', name: 'World', lat: 20, lon: 10, zoom: 1 },
  { id: 'europe', name: 'Europe', lat: 52, lon: 15, zoom: 4.2 },
  { id: 'asia', name: 'East Asia', lat: 30, lon: 120, zoom: 3.4 },
  { id: 'middle-east', name: 'Middle East', lat: 28, lon: 45, zoom: 3.6 },
  { id: 'americas', name: 'Americas', lat: 10, lon: -80, zoom: 2.2 },
  { id: 'africa', name: 'Africa', lat: 2, lon: 20, zoom: 2.6 },
];

const ALIGNMENTS = [
  { id: 'west', name: 'Western-aligned', labelKey: 'legend.west', blocs: ['nato', 'eu', 'usAllied'], slot: 1 },
  { id: 'east', name: 'Eastern-aligned', labelKey: 'legend.east', blocs: ['brics', 'sco', 'csto'], slot: 2 },
  { id: 'regional', name: 'Regional bloc', labelKey: 'legend.regional', blocs: ['gcc', 'asean', 'au'], slot: 3 },
];

export function project(lat, lon) {
  const x = ((lon + 180) / 360) * W;
  const y = ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * H;
  return [x, y];
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  }
  return el;
}

/** A set of closed [lon, lat] rings as one SVG path. */
function ringsToPath(rings) {
  let d = '';
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = project(ring[i][1], ring[i][0]);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }
    d += 'Z';
  }
  return d;
}

function ringToPath(ring) {
  return `${ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lat, lon);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('')}Z`;
}

/**
 * Which of the three alignment slots (or none) a country sits in.
 * Pass the game to read live membership — countries change sides mid-run.
 */
export function alignmentOf(nationId, game = null) {
  const blocs = game ? blocsOf(game, nationId) : NATIONS_BY_ID[nationId]?.blocs || [];
  for (const alignment of ALIGNMENTS) {
    if (alignment.blocs.some((b) => blocs.includes(b))) return alignment;
  }
  return null;
}

export class WorldMap {
  /**
   * @param {HTMLElement} container
   * @param {{onSelect?: Function, onHover?: Function, onViewChange?: Function}} handlers
   */
  constructor(container, { onSelect, onHover, onViewChange } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onViewChange = onViewChange;
    this.selectedId = null;
    this.mode = 'relations';
    this.camera = { zoom: 1, x: 0, y: 0 };
    this.game = null;
    this.nodeEls = new Map();
    this.territoryEls = new Map();
    this.showTerritory = true;
    // Set while a pan is finishing, so releasing the mouse over a country does
    // not also select it.
    this.justPanned = false;

    this.root = svg('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'worldmap',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'application',
      'aria-label': 'World situation map',
    });
    container.append(this.root);
    this.#bindCamera();
  }

  setMode(mode) {
    this.mode = mode;
    if (this.game) this.render(this.game);
  }

  setSelected(id) {
    this.selectedId = id;
    for (const [nationId, el] of this.nodeEls) {
      el.classList.toggle('is-selected', nationId === id);
    }
    for (const [nationId, el] of this.territoryEls) {
      el.classList.toggle('is-selected', nationId === id);
    }
    this.#drawOutline();
  }

  /** Turn the filled-territory layer on or off. */
  setShowTerritory(on) {
    this.showTerritory = Boolean(on);
    if (this.game) this.render(this.game);
  }

  /** Move the camera to a named region. */
  focusOn(focusId) {
    const focus = MAP_FOCUSES.find((f) => f.id === focusId) || MAP_FOCUSES[0];
    const [x, y] = project(focus.lat, focus.lon);
    this.camera.zoom = focus.zoom;
    this.camera.x = W / 2 - x * focus.zoom;
    this.camera.y = H / 2 - y * focus.zoom;
    this.#clampCamera();
    this.#applyCamera();
  }

  /** Centre the camera on one country without changing zoom. */
  centreOn(nationId, zoom = null) {
    const def = defOf(this.game, nationId);
    if (!def) return;
    if (zoom !== null) this.camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const [x, y] = project(def.lat, def.lon);
    this.camera.x = W / 2 - x * this.camera.zoom;
    this.camera.y = H / 2 - y * this.camera.zoom;
    this.#clampCamera();
    this.#applyCamera();
  }

  /** Pan by a distance in map units — the keyboard's way to move the camera. */
  panBy(dx, dy) {
    this.camera.x += dx;
    this.camera.y += dy;
    this.#clampCamera();
    this.#applyCamera();
  }

  zoomBy(factor) {
    this.#zoomAt(W / 2, H / 2, factor);
  }

  resetCamera() {
    this.camera = { zoom: 1, x: 0, y: 0 };
    this.#applyCamera();
  }

  get zoom() {
    return this.camera.zoom;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  render(game) {
    this.game = game;
    while (this.root.firstChild) this.root.removeChild(this.root.firstChild);
    this.nodeEls.clear();
    // On a phone the true aspect ratio gives a 130px letterbox strip. Filling
    // the taller box instead crops the empty Pacific, which panning gets back.
    this.root.setAttribute(
      'preserveAspectRatio',
      this.container.clientWidth > 0 && this.container.clientWidth < 700
        ? 'xMidYMid slice'
        : 'xMidYMid meet',
    );

    this.root.append(this.#defs());

    // Everything except the ocean backdrop lives under one pannable group.
    this.root.append(svg('rect', { x: 0, y: 0, width: W, height: H, class: 'map-ocean' }));

    const scene = svg('g', { class: 'map-scene' });
    this.scene = scene;
    scene.append(this.#graticule(), this.#land());
    if (this.showTerritory) scene.append(this.#territories(game));
    scene.append(this.#oceanLabels());
    scene.append(this.#links(game));

    const nodes = svg('g', { class: 'map-nodes' });
    const labels = svg('g', { class: 'map-labels' });
    // Big powers painted first so smaller neighbours land on top and stay clickable.
    const ranked = sovereignIds(game)
      .map((id) => ({ id, power: livePower(game, id) }))
      .sort((a, b) => b.power - a.power);
    const maxPower = Math.max(...ranked.map((r) => r.power), 1);
    for (const { id, power } of ranked) {
      const node = this.#node(game, id, power / maxPower);
      nodes.append(node);
      labels.append(this.#label(game, id, node.dataset));
      this.nodeEls.set(id, node);
    }
    scene.append(nodes, labels);

    this.root.append(scene);
    this.#applyCamera();
    this.setSelected(this.selectedId);
  }

  #defs() {
    const defs = svg('defs');
    const glow = svg('filter', { id: 'pax-node-glow', x: '-70%', y: '-70%', width: '240%', height: '240%' });
    glow.append(svg('feGaussianBlur', { stdDeviation: '5', result: 'b' }));
    const merge = svg('feMerge');
    merge.append(svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' }));
    glow.append(merge);
    defs.append(glow);
    return defs;
  }

  #graticule() {
    const g = svg('g', { class: 'map-grid' });
    for (let lon = -180; lon <= 180; lon += 30) {
      const [x] = project(0, lon);
      g.append(svg('line', { x1: x, y1: 0, x2: x, y2: H }));
    }
    for (let lat = -40; lat <= 80; lat += 20) {
      const [, y] = project(lat, 0);
      g.append(svg('line', { x1: 0, y1: y, x2: W, y2: y, class: lat === 0 ? 'equator' : '' }));
    }
    return g;
  }

  #land() {
    const g = svg('g', { class: 'map-land' });
    for (const mass of LANDMASSES) {
      // Ring first, then any inland seas as further subpaths — the even-odd
      // fill rule punches them out.
      const d = ringToPath(mass.ring) + (mass.holes || []).map(ringToPath).join('');
      g.append(svg('path', { d, class: 'map-land__shape', 'fill-rule': 'evenodd' }));
    }
    return g;
  }

  /**
   * The land each country actually holds, filled in that country's colour for
   * the active view mode. This is the layer wars, coups and secessions move.
   */
  #territories(game) {
    const g = svg('g', { class: 'map-territories' });
    this.territoryEls = new Map();

    // Each country is one closed, smoothed outline. Filled and stroked in the
    // same path, so its own border is always exactly on its own edge.
    for (const ownerId of holders(game)) {
      const rings = outlineFor(game, ownerId);
      if (!rings.length) continue;
      const { fill, opacity } = this.#encoding(game, ownerId);
      const isPlayer = ownerId === game.playerId;
      const path = svg('path', {
        d: ringsToPath(rings),
        class: `map-territory${isPlayer ? ' is-player' : ''}`,
        style: `fill:${fill};fill-opacity:${(opacity * (isPlayer ? 0.82 : 0.62)).toFixed(2)}`,
      });
      path.dataset.nation = ownerId;
      path.dataset.area = areaOf(game, ownerId).toFixed(0);
      path.addEventListener('pointerenter', () => this.onHover?.(ownerId));
      path.addEventListener('pointerleave', () => this.onHover?.(null));
      path.addEventListener('click', (e) => {
        if (this.justPanned) return;
        e.stopPropagation();
        this.onSelect?.(ownerId);
      });
      this.territoryEls.set(ownerId, path);
      g.append(path);
    }

    this.outlineEl = svg('path', { class: 'map-territory__outline' });
    g.append(this.outlineEl);
    this.#drawOutline();
    return g;
  }

  /** Trace the country you are looking at, so "mine" is unmistakable. */
  #drawOutline() {
    if (!this.outlineEl || !this.game) return;
    const id = this.selectedId || this.game.playerId;
    this.outlineEl.setAttribute('d', id ? ringsToPath(outlineFor(this.game, id)) : '');
    this.outlineEl.classList.toggle('is-player', id === this.game.playerId);
  }

  #oceanLabels() {
    const g = svg('g', { class: 'map-oceans' });
    for (const ocean of OCEANS) {
      const [x, y] = project(ocean.lat, ocean.lon);
      const text = svg('text', { x, y, 'text-anchor': 'middle' });
      text.textContent = ocean.name.toUpperCase();
      g.append(text);
    }
    return g;
  }

  #links(game) {
    const g = svg('g', { class: 'map-links' });
    for (const war of game.wars) {
      if (!war.active) continue;
      for (const a of war.attackers) {
        for (const b of war.defenders) g.append(this.#link(a, b, 'war'));
      }
    }
    if (this.mode === 'relations' || this.mode === 'conflict') {
      for (const id of sovereignIds(game)) {
        if (id === game.playerId) continue;
        const rel = getRelation(game, game.playerId, id);
        if (rel >= 65) g.append(this.#link(game.playerId, id, 'ally'));
        else if (rel <= -55) g.append(this.#link(game.playerId, id, 'rival'));
      }
    }
    return g;
  }

  #link(aId, bId, kind) {
    const a = defOf(this.game, aId);
    const b = defOf(this.game, bId);
    if (!a || !b) return svg('path', { d: '', class: 'map-link' });
    const [x1, y1] = project(a.lat, a.lon);
    const [x2, y2] = project(b.lat, b.lon);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.12;
    return svg('path', {
      d: `M${x1},${y1} Q${mx},${my} ${x2},${y2}`,
      class: `map-link map-link--${kind}`,
    });
  }

  /**
   * Colour + opacity for one country under the active view mode.
   * Every value here comes from a theme variable, never a literal.
   */
  #encoding(game, id) {
    const state = game.nations[id];
    if (id === game.playerId) return { fill: 'var(--accent)', opacity: 1 };
    // A breakaway can hold ground before it has a full sheet of statistics.
    if (!state) return { fill: 'var(--dv-neutral)', opacity: 0.8 };

    switch (this.mode) {
      case 'power': {
        const ranked = sovereignIds(game).map((n) => livePower(game, n));
        const min = Math.min(...ranked);
        const max = Math.max(...ranked);
        return { fill: rampStep((livePower(game, id) - min) / Math.max(1, max - min)), opacity: 1 };
      }
      case 'stability':
        return { fill: rampStep(state.stability / 100), opacity: 1 };
      case 'blocs': {
        const alignment = alignmentOf(id, game);
        return {
          fill: alignment ? `var(--dv-cat-${alignment.slot})` : 'var(--dv-neutral)',
          opacity: 1,
        };
      }
      case 'conflict': {
        const atWar = game.wars.some(
          (w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)),
        );
        if (atWar) return { fill: 'var(--st-critical)', opacity: 1 };
        const rel = getRelation(game, game.playerId, id);
        if (rel <= -55) return { fill: 'var(--st-serious)', opacity: 1 };
        if (rel <= -25) return { fill: 'var(--st-warning)', opacity: 1 };
        return { fill: 'var(--dv-neutral)', opacity: 1 };
      }
      default: {
        // Diverging: one hue per arm, intensity carried by opacity so no
        // undocumented hexes get invented for the intermediate steps.
        const rel = getRelation(game, game.playerId, id);
        if (rel >= 55) return { fill: 'var(--dv-positive)', opacity: 1 };
        if (rel >= 20) return { fill: 'var(--dv-positive)', opacity: 0.55 };
        if (rel > -20) return { fill: 'var(--dv-neutral)', opacity: 1 };
        if (rel > -55) return { fill: 'var(--dv-negative)', opacity: 0.55 };
        return { fill: 'var(--dv-negative)', opacity: 1 };
      }
    }
  }

  #node(game, id, powerRatio) {
    const def = defOf(game, id);
    const [x, y] = project(def.lat, def.lon);
    const isPlayer = id === game.playerId;
    const baseRadius = 5 + powerRatio * 10;
    const { fill, opacity } = this.#encoding(game, id);

    const g = svg('g', {
      class: `map-node${isPlayer ? ' is-player' : ''}`,
      transform: `translate(${x},${y})`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${tNation(def)}. ${describeFor(game, id, this.mode)}`,
    });
    g.dataset.nation = id;
    g.dataset.baseRadius = String(baseRadius);
    g.dataset.major = String(powerRatio > 0.78 || isPlayer);

    if (isPlayer) {
      g.append(svg('circle', { r: baseRadius + 7, class: 'map-node__halo', filter: 'url(#pax-node-glow)' }));
    }
    const atWar = game.wars.some(
      (w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)),
    );
    // The war ring is a shape channel, so "at war" never rests on colour alone.
    if (atWar) g.append(svg('circle', { r: baseRadius + 4.5, class: 'map-node__war' }));

    g.append(svg('circle', { r: baseRadius + 4, class: 'map-node__hit' }));
    g.append(svg('circle', { r: baseRadius, class: 'map-node__dot', style: `fill:${fill};fill-opacity:${opacity}` }));

    g.addEventListener('click', (e) => {
      if (this.justPanned) return;
      e.stopPropagation();
      this.onSelect?.(id);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onSelect?.(id);
      }
    });
    g.addEventListener('pointerenter', () => this.onHover?.(id));
    g.addEventListener('focus', () => this.onHover?.(id));
    g.addEventListener('pointerleave', () => this.onHover?.(null));
    g.addEventListener('blur', () => this.onHover?.(null));

    return g;
  }

  #label(game, id, dataset) {
    const def = defOf(game, id);
    const [x, y] = project(def.lat, def.lon);
    const text = svg('text', {
      x, y: y + Number(dataset.baseRadius) + 12,
      'text-anchor': 'middle',
      class: `map-node__label${id === game.playerId ? ' is-player' : ''}`,
    });
    text.dataset.labelFor = id;
    text.dataset.baseRadius = dataset.baseRadius;
    text.dataset.major = dataset.major;
    text.textContent = tNation(def);
    return text;
  }

  // ── Camera ───────────────────────────────────────────────────────────────

  #bindCamera() {
    let dragging = false;
    let moved = false;
    let last = null;
    // Live touch points, so two fingers can pinch. Without this a phone has no
    // way to zoom at all: there is no wheel to turn.
    const touches = new Map();
    let pinch = null;

    // Belt and braces for the browsers that start a selection before
    // pointerdown fires.
    this.root.addEventListener('dragstart', (e) => e.preventDefault());
    this.root.addEventListener('selectstart', (e) => e.preventDefault());

    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const point = this.#toSvg(e.clientX, e.clientY);
      this.#zoomAt(point.x, point.y, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });

    this.root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // Second finger down: stop panning and start pinching.
        dragging = false;
        pinch = this.#pinchState(touches);
        return;
      }
      if (e.button !== 0) return;
      // Without this the browser starts a text selection on the labels and the
      // drag turns into a highlight sweep instead of a pan.
      e.preventDefault();
      dragging = true;
      moved = false;
      this.justPanned = false;
      last = { x: e.clientX, y: e.clientY };
      this.root.classList.add('is-dragging');
    });

    this.root.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const now = this.#pinchState(touches);
        if (now.distance > 0 && pinch.distance > 0) {
          const point = this.#toSvg(now.x, now.y);
          this.#zoomAt(point.x, point.y, now.distance / pinch.distance);
          this.justPanned = true;
        }
        pinch = now;
        e.preventDefault();
        return;
      }
      if (!dragging) return;
      const rect = this.root.getBoundingClientRect();
      const scale = W / rect.width;
      const dx = (e.clientX - last.x) * scale;
      const dy = (e.clientY - last.y) * scale;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 2) {
        moved = true;
        // Capture only once a real drag starts. Capturing on pointerdown
        // retargets the subsequent click to the <svg>, which swallowed every
        // click on a country.
        try {
          this.root.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety, not a requirement */
        }
      }
      if (!moved) return;
      this.camera.x += dx;
      this.camera.y += dy;
      last = { x: e.clientX, y: e.clientY };
      this.#clampCamera();
      this.#applyCamera();
    });

    const endDrag = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (!dragging) return;
      dragging = false;
      this.justPanned = moved;
      this.root.classList.remove('is-dragging');
      try {
        this.root.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    };
    this.root.addEventListener('pointerup', endDrag);
    this.root.addEventListener('pointercancel', endDrag);

    // Clicking empty ocean clears the pinned selection, but only if you did
    // not just finish a pan.
    this.root.addEventListener('click', (e) => {
      // Only a genuine click on open water clears the pinned country.
      if (moved) return;
      if (e.target instanceof Element && e.target.closest('.map-node')) return;
      this.onSelect?.(null);
    });

    this.root.addEventListener('keydown', (e) => {
      const step = 40;
      if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.25);
      else if (e.key === '0') this.resetCamera();
      else if (e.key === 'ArrowLeft') this.#pan(step, 0);
      else if (e.key === 'ArrowRight') this.#pan(-step, 0);
      else if (e.key === 'ArrowUp') this.#pan(0, step);
      else if (e.key === 'ArrowDown') this.#pan(0, -step);
      else return;
      e.preventDefault();
    });
  }

  #pan(dx, dy) {
    this.camera.x += dx;
    this.camera.y += dy;
    this.#clampCamera();
    this.#applyCamera();
  }

  /** Midpoint and separation of two fingers, in client coordinates. */
  #pinchState(touches) {
    const [a, b] = [...touches.values()];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  #toSvg(clientX, clientY) {
    const rect = this.root.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  /** Zoom keeping the point under the cursor fixed. */
  #zoomAt(px, py, factor) {
    const before = this.camera.zoom;
    const after = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, before * factor));
    if (after === before) return;
    // Solve for the translation that keeps (px, py) over the same world point.
    this.camera.x = px - ((px - this.camera.x) / before) * after;
    this.camera.y = py - ((py - this.camera.y) / before) * after;
    this.camera.zoom = after;
    this.#clampCamera();
    this.#applyCamera();
  }

  /** Keep the map covering the viewport — no panning off into empty space. */
  #clampCamera() {
    const z = this.camera.zoom;
    const minX = W - W * z;
    const minY = H - H * z;
    this.camera.x = Math.min(0, Math.max(minX, this.camera.x));
    this.camera.y = Math.min(0, Math.max(minY, this.camera.y));
  }

  #applyCamera() {
    const { zoom, x, y } = this.camera;
    if (this.scene) {
      this.scene.setAttribute('transform', `translate(${x},${y}) scale(${zoom})`);
    }
    this.root.dataset.zoom = zoom.toFixed(2);

    // Counter-scale the marks so they keep a constant on-screen size: zooming in
    // then genuinely separates crowded regions instead of magnifying the blobs.
    const inv = 1 / zoom;
    for (const [, node] of this.nodeEls) {
      const base = Number(node.dataset.baseRadius) || 6;
      for (const circle of node.querySelectorAll('circle')) {
        const cls = circle.getAttribute('class') || '';
        const offset = cls.includes('halo') ? 7 : cls.includes('war') ? 4.5 : cls.includes('hit') ? 4 : 0;
        circle.setAttribute('r', String((base + offset) * inv));
      }
    }
    for (const label of this.root.querySelectorAll('.map-labels text')) {
      const base = Number(label.dataset.baseRadius) || 6;
      const def = defOf(this.game, label.dataset.labelFor);
      if (!def) continue;
      const [, y] = project(def.lat, def.lon);
      label.setAttribute('y', String(y + (base + 11) * inv));
      label.setAttribute('font-size', String(11 * inv));
      // Everything gets a name once you have zoomed in far enough to read it.
      label.style.opacity = label.dataset.major === 'true' || zoom >= 1.8 ? '' : '0';
    }
    for (const el of this.root.querySelectorAll('.map-oceans text')) {
      el.setAttribute('font-size', String(13 * inv));
    }
    this.root.style.setProperty('--map-inv-zoom', String(inv));
    this.onViewChange?.(this.camera);
  }
}

function rampStep(ratio) {
  const step = Math.min(5, Math.max(1, Math.ceil(ratio * 5) || 1));
  return `var(--dv-seq-${step})`;
}

/** The accessible-name text for a node under the active mode. */
function describeFor(game, id, mode) {
  const state = game.nations[id];
  switch (mode) {
    case 'power': return `Power ${Math.round(livePower(game, id))}`;
    case 'stability': return `Stability ${Math.round(state.stability)}`;
    case 'blocs': return alignmentOf(id, game)?.name || 'Non-aligned';
    case 'conflict':
      return game.wars.some((w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)))
        ? 'At war'
        : 'Not at war';
    default: return `Relation ${Math.round(getRelation(game, game.playerId, id))}`;
  }
}

/** Legend rows for the active mode: [{ label, fill, opacity, shape }]. */
export function legendFor(mode) {
  switch (mode) {
    case 'power':
    case 'stability':
      return [
        { label: t('legend.low', 'Low'), fill: 'var(--dv-seq-1)' },
        { label: '', fill: 'var(--dv-seq-2)' },
        { label: '', fill: 'var(--dv-seq-3)' },
        { label: '', fill: 'var(--dv-seq-4)' },
        { label: t('legend.high', 'High'), fill: 'var(--dv-seq-5)' },
      ];
    case 'blocs':
      return [
        ...ALIGNMENTS.map((a) => ({ label: t(a.labelKey, a.name), fill: `var(--dv-cat-${a.slot})` })),
        { label: t('legend.nonAligned', 'Non-aligned'), fill: 'var(--dv-neutral)' },
      ];
    case 'conflict':
      return [
        { label: t('legend.atWar', 'At war'), fill: 'var(--st-critical)', shape: 'ring' },
        { label: t('legend.hostile', 'Hostile'), fill: 'var(--st-serious)' },
        { label: t('legend.cool', 'Cool'), fill: 'var(--st-warning)' },
        { label: t('legend.noFriction', 'No friction'), fill: 'var(--dv-neutral)' },
      ];
    default:
      return [
        { label: t('legend.allied', 'Allied'), fill: 'var(--dv-positive)' },
        { label: t('legend.friendly', 'Friendly'), fill: 'var(--dv-positive)', opacity: 0.55 },
        { label: t('legend.neutral', 'Neutral'), fill: 'var(--dv-neutral)' },
        { label: t('legend.cool', 'Cool'), fill: 'var(--dv-negative)', opacity: 0.55 },
        { label: t('legend.hostile', 'Hostile'), fill: 'var(--dv-negative)' },
      ];
  }
}
