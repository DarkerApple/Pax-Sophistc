// The situation map. An equirectangular plot of every country in the game,
// sized by live power and coloured by how they feel about you.

import { NATIONS_BY_ID, REGIONS } from '../data/nations.js';
import { getRelation, livePower } from '../engine/state.js';
import { relationColour, relationLabel } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 500;
const LAT_TOP = 78;
const LAT_BOTTOM = -56;

function project(lat, lon) {
  const x = ((lon + 180) / 360) * W;
  const y = ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * H;
  return [x, Math.max(6, Math.min(H - 6, y))];
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  }
  return el;
}

export class WorldMap {
  /**
   * @param {HTMLElement} container
   * @param {{onSelect?: (id: string) => void}} handlers
   */
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.selectedId = null;
    this.root = svg('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'worldmap',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'World situation map',
    });
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'map-tooltip';
    this.tooltip.hidden = true;
    container.append(this.root, this.tooltip);
  }

  setSelected(id) {
    this.selectedId = id;
    this.#applySelection();
  }

  #applySelection() {
    for (const node of this.root.querySelectorAll('[data-nation]')) {
      node.classList.toggle('is-selected', node.dataset.nation === this.selectedId);
    }
  }

  render(game) {
    while (this.root.firstChild) this.root.removeChild(this.root.firstChild);

    const defs = svg('defs');
    const glow = svg('filter', { id: 'node-glow', x: '-60%', y: '-60%', width: '220%', height: '220%' });
    glow.append(svg('feGaussianBlur', { stdDeviation: '6', result: 'b' }));
    const merge = svg('feMerge');
    merge.append(svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' }));
    glow.append(merge);
    defs.append(glow);
    this.root.append(defs);

    this.root.append(this.#graticule(), this.#regionLabels());

    const links = svg('g', { class: 'map-links' });
    const nodes = svg('g', { class: 'map-nodes' });

    // Wars first, so they sit under the nodes.
    for (const war of game.wars) {
      if (!war.active) continue;
      for (const a of war.attackers) {
        for (const b of war.defenders) {
          links.append(this.#link(a, b, 'war'));
        }
      }
    }
    // The player's closest and worst relationships.
    for (const id of Object.keys(game.nations)) {
      if (id === game.playerId) continue;
      const rel = getRelation(game, game.playerId, id);
      if (rel >= 65) links.append(this.#link(game.playerId, id, 'ally'));
      else if (rel <= -55) links.append(this.#link(game.playerId, id, 'rival'));
    }

    // Paint the big powers first so smaller neighbours end up on top and stay
    // clickable where the map is crowded.
    const ranked = Object.keys(game.nations)
      .map((id) => ({ id, power: livePower(game, id) }))
      .sort((a, b) => b.power - a.power);
    const maxPower = Math.max(...ranked.map((r) => r.power), 1);

    for (const { id, power } of ranked) {
      nodes.append(this.#node(game, id, power / maxPower));
    }

    this.root.append(links, nodes);
    this.#applySelection();
  }

  #graticule() {
    const g = svg('g', { class: 'map-grid' });
    for (let lon = -180; lon <= 180; lon += 30) {
      const [x] = project(0, lon);
      g.append(svg('line', { x1: x, y1: 0, x2: x, y2: H }));
    }
    for (let lat = LAT_BOTTOM; lat <= LAT_TOP; lat += 20) {
      const [, y] = project(lat, 0);
      g.append(svg('line', { x1: 0, y1: y, x2: W, y2: y, class: lat === 0 ? 'equator' : '' }));
    }
    return g;
  }

  #regionLabels() {
    const g = svg('g', { class: 'map-regions' });
    for (const region of REGIONS) {
      const [x, y] = project(region.lat, region.lon);
      const text = svg('text', { x, y: y - 40, 'text-anchor': 'middle' });
      text.textContent = region.name.toUpperCase();
      g.append(text);
    }
    return g;
  }

  #link(aId, bId, kind) {
    const a = NATIONS_BY_ID[aId];
    const b = NATIONS_BY_ID[bId];
    const [x1, y1] = project(a.lat, a.lon);
    const [x2, y2] = project(b.lat, b.lon);
    // Curve the link so overlapping pairs stay legible.
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.12;
    return svg('path', {
      d: `M${x1},${y1} Q${mx},${my} ${x2},${y2}`,
      class: `map-link map-link--${kind}`,
    });
  }

  #node(game, id, powerRatio) {
    const def = NATIONS_BY_ID[id];
    const [x, y] = project(def.lat, def.lon);
    const isPlayer = id === game.playerId;
    const relation = getRelation(game, game.playerId, id);
    const radius = 4.5 + powerRatio * 11;

    const g = svg('g', {
      class: `map-node${isPlayer ? ' is-player' : ''}`,
      transform: `translate(${x},${y})`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${def.name}: ${relationLabel(relation)}`,
    });
    g.dataset.nation = id;

    if (isPlayer) {
      g.append(svg('circle', { r: radius + 7, class: 'map-node__halo', filter: 'url(#node-glow)' }));
    }
    const atWar = game.wars.some(
      (w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)),
    );
    if (atWar) g.append(svg('circle', { r: radius + 4, class: 'map-node__war' }));

    // Invisible, generous hit area — the dots are small and the labels push
    // the group's bounding box away from them.
    g.append(svg('circle', { r: Math.max(radius + 3, 8), class: 'map-node__hit' }));

    g.append(
      svg('circle', {
        r: radius,
        class: 'map-node__dot',
        style: `fill:${isPlayer ? 'var(--accent)' : relationColour(relation)}`,
      }),
    );

    // Label sparingly: Europe alone would otherwise be a wall of text.
    if (isPlayer || powerRatio > 0.82) {
      const label = svg('text', { y: radius + 13, 'text-anchor': 'middle', class: 'map-node__label' });
      label.textContent = def.name;
      g.append(label);
    }

    g.addEventListener('click', () => this.onSelect?.(id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onSelect?.(id);
      }
    });
    g.addEventListener('pointerenter', () => this.#showTip(game, id));
    g.addEventListener('pointerleave', () => {
      this.tooltip.hidden = true;
    });
    g.addEventListener('pointermove', (e) => this.#moveTip(e));

    return g;
  }

  #showTip(game, id) {
    const def = NATIONS_BY_ID[id];
    const state = game.nations[id];
    const relation = getRelation(game, game.playerId, id);
    this.tooltip.innerHTML = `
      <strong>${def.flag} ${def.name}</strong>
      <span>GDP $${state.gdp.toFixed(2)}T · Military ${Math.round(state.military)} · Stability ${Math.round(state.stability)}</span>
      <span class="tip-relation" style="color:${relationColour(relation)}">${
        id === game.playerId ? 'Your country' : `${relationLabel(relation)} (${Math.round(relation)})`
      }</span>`;
    this.tooltip.hidden = false;
  }

  #moveTip(event) {
    const bounds = this.container.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    this.tooltip.style.left = `${Math.min(x + 14, bounds.width - 200)}px`;
    this.tooltip.style.top = `${Math.max(y - 60, 8)}px`;
  }
}
