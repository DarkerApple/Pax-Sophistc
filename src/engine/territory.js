// Who actually holds which patch of ground.
//
// The map used to be 56 dots on a silhouette. Territory turns it into land you
// can win, lose, sell or lose to a breakaway province — which is what wars,
// coups and secessions need in order to mean anything visually.
//
// How it works
//   1. The continent rings in data/geography.js are rasterised into a fixed
//      grid of land cells. Deterministic, so it never has to be saved.
//   2. Each land cell is claimed by whichever capital minimises distance/reach,
//      where "reach" is a per-country radius fitted so the resulting claim is
//      close to that country's real land area. Cells outside every reach stay
//      unclaimed and render as no-man's-land.
//   3. That baseline is also deterministic, so a save only has to store the
//      cells that have since *changed hands* — a few hundred integers instead
//      of seven thousand.
//
// Nothing here is a border claim. It is a playable abstraction at ~165 km
// resolution, which is coarser than most disputes it would have an opinion on.

import { LANDMASSES } from '../data/geography.js';
import { NATIONS_BY_ID } from '../data/nations.js';
import { DEFAULT_SCENARIO, scenarioOf } from '../data/scenarios.js';

export const GRID = {
  lonMin: -180,
  lonMax: 180,
  latMin: -58,
  latMax: 84,
  // One degree ≈ 110 km at the equator. Finer than this and the fit stops
  // paying for itself; coarser and small countries lose their shape.
  step: 1,
};

export const COLS = Math.round((GRID.lonMax - GRID.lonMin) / GRID.step);
export const ROWS = Math.round((GRID.latMax - GRID.latMin) / GRID.step);

const EARTH_R = 6371;
const KM_PER_DEG = 111.32;

export function cellIndex(col, row) {
  return row * COLS + col;
}

export function cellColRow(index) {
  return [index % COLS, Math.floor(index / COLS)];
}

/** Centre of a cell, in degrees. */
export function cellCentre(index) {
  const [col, row] = cellColRow(index);
  return {
    lon: GRID.lonMin + (col + 0.5) * GRID.step,
    lat: GRID.latMax - (row + 0.5) * GRID.step,
  };
}

/** Corner bounds of a cell, in degrees: [west, south, east, north]. */
export function cellBounds(index) {
  const [col, row] = cellColRow(index);
  const west = GRID.lonMin + col * GRID.step;
  const north = GRID.latMax - row * GRID.step;
  return [west, north - GRID.step, west + GRID.step, north];
}

/** Real-world km² a cell covers — shrinks toward the poles. */
export function cellArea(index) {
  const { lat } = cellCentre(index);
  return GRID.step * GRID.step * KM_PER_DEG * KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
}

function haversine(aLat, aLon, bLat, bLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_R * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Rasterising the continents ──────────────────────────────────────────────

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > lat !== yj > lat;
    if (straddles && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let landCache = null;

/**
 * Every grid index that falls on land, ascending.
 * @returns {number[]}
 */
export function landCells() {
  if (landCache) return landCache;
  const cells = [];
  const boxes = LANDMASSES.map((mass) => {
    let west = 180;
    let east = -180;
    let south = 90;
    let north = -90;
    for (const [lon, lat] of mass.ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    return { ring: mass.ring, holes: mass.holes || [], west, east, south, north };
  });

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = cellIndex(col, row);
      const { lon, lat } = cellCentre(index);
      for (const box of boxes) {
        if (lon < box.west || lon > box.east || lat < box.south || lat > box.north) continue;
        if (!pointInRing(lon, lat, box.ring)) continue;
        // An inland sea is not land, and the countries around it should not be
        // handed it as territory.
        if (box.holes.some((hole) => pointInRing(lon, lat, hole))) break;
        cells.push(index);
        break;
      }
    }
  }
  landCache = cells;
  return cells;
}

// ── Fitting each country's reach ────────────────────────────────────────────

// A country claims a cell when distance/reach is the lowest bid and below 1 —
// so "reach" is literally a radius in kilometres. Starting from the radius of a
// circle with the country's real area, a few damped passes pull each radius
// until the claimed area lands near the real one.
const FIT_PASSES = 40;

/** Unit-sphere vector, so the hot loop costs a dot product and one acos. */
function unitVector(lat, lon) {
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  const c = Math.cos(φ);
  return [c * Math.cos(λ), c * Math.sin(λ), Math.sin(φ)];
}

function fitReach(roster) {
  const defs = roster.filter((n) => Number.isFinite(n.area) && n.area > 0);
  const cells = landCells();
  const areas = cells.map(cellArea);
  const reach = defs.map((def) => Math.sqrt((def.area * 1000) / Math.PI));
  const target = defs.map((def) => def.area * 1000);
  const claimed = new Array(defs.length).fill(0);
  let assignment = new Int16Array(cells.length).fill(-1);

  const cellVec = new Float64Array(cells.length * 3);
  for (let c = 0; c < cells.length; c++) {
    const { lat, lon } = cellCentre(cells[c]);
    const [x, y, z] = unitVector(lat, lon);
    cellVec[c * 3] = x;
    cellVec[c * 3 + 1] = y;
    cellVec[c * 3 + 2] = z;
  }
  const seatVec = defs.map((def) => unitVector(def.lat, def.lon));

  for (let pass = 0; pass < FIT_PASSES; pass++) {
    claimed.fill(0);
    assignment = new Int16Array(cells.length).fill(-1);
    for (let c = 0; c < cells.length; c++) {
      const cx = cellVec[c * 3];
      const cy = cellVec[c * 3 + 1];
      const cz = cellVec[c * 3 + 2];
      let best = 1;
      let bestIdx = -1;
      for (let n = 0; n < defs.length; n++) {
        const s = seatVec[n];
        const dot = cx * s[0] + cy * s[1] + cz * s[2];
        const km = EARTH_R * Math.acos(dot > 1 ? 1 : dot < -1 ? -1 : dot);
        const score = km / reach[n];
        if (score < best) {
          best = score;
          bestIdx = n;
        }
      }
      assignment[c] = bestIdx;
      if (bestIdx >= 0) claimed[bestIdx] += areas[c];
    }
    if (pass === FIT_PASSES - 1) break;
    for (let n = 0; n < defs.length; n++) {
      // Damped *and* rate-limited. Without the cap, a country that lost every
      // cell in one pass would leap back with a radius big enough to swallow a
      // whole archipelago, and the fit would oscillate forever instead of
      // settling. (Malaysia, hello.)
      const ratio = target[n] / Math.max(claimed[n], target[n] * 0.05);
      const step = Math.pow(ratio, 0.16);
      reach[n] *= Math.min(1.22, Math.max(0.82, step));
    }
  }

  const owners = new Array(cells.length);
  for (let c = 0; c < cells.length; c++) {
    owners[c] = assignment[c] >= 0 ? defs[assignment[c]].id : null;
  }

  // A city-state smaller than one cell would otherwise vanish from its own map.
  // Give every playable country at least the ground it stands on.
  for (let n = 0; n < defs.length; n++) {
    if (owners.some((o) => o === defs[n].id)) continue;
    const s = seatVec[n];
    let bestC = -1;
    let bestDot = -2;
    for (let c = 0; c < cells.length; c++) {
      const dot = cellVec[c * 3] * s[0] + cellVec[c * 3 + 1] * s[1] + cellVec[c * 3 + 2] * s[2];
      if (dot > bestDot) {
        bestDot = dot;
        bestC = c;
      }
    }
    if (bestC >= 0) owners[bestC] = defs[n].id;
  }
  return owners;
}

/** One fitted map per scenario — the fit is expensive and never changes. */
const baseCache = new Map();

/**
 * The unchanging starting map for a scenario: owner id (or null) per entry of
 * landCells(). An era with a different roster gets a different starting map,
 * fitted the same way.
 * @returns {Array<string|null>}
 */
export function baseOwners(scenarioId = DEFAULT_SCENARIO) {
  const world = scenarioOf(scenarioId);
  const key = world.id;
  if (!baseCache.has(key)) baseCache.set(key, fitReach(world.nations));
  return baseCache.get(key);
}

// ── Live ownership ──────────────────────────────────────────────────────────

export function createTerritory() {
  // Only the deltas are stored; the baseline is recomputed from data.
  // `revision` counts every change so the drawing caches can tell, exactly,
  // whether anything moved — and `changed` remembers which turn each cell last
  // changed hands, which is how the map shows the quarter's front.
  return { overrides: {}, claims: {}, revision: 0, changed: {} };
}

function overridesOf(game) {
  if (!game.territory) game.territory = createTerritory();
  if (!game.territory.overrides) game.territory.overrides = {};
  return game.territory.overrides;
}

/** Owner id of one land-cell slot (an index into landCells()), or null. */
export function ownerAt(game, slot) {
  const override = overridesOf(game)[slot];
  if (override !== undefined) return override === '' ? null : override;
  return baseOwners(game?.scenario)[slot] ?? null;
}

let ownedCache = new WeakMap();

/** Map of ownerId -> array of land-cell slots. Rebuilt when ownership changes. */
export function ownershipIndex(game) {
  const cached = ownedCache.get(game);
  const stamp = territoryStamp(game);
  if (cached && cached.stamp === stamp) return cached.index;

  const index = new Map();
  const base = baseOwners(game?.scenario);
  const overrides = overridesOf(game);
  for (let slot = 0; slot < base.length; slot++) {
    const override = overrides[slot];
    const owner = override !== undefined ? (override === '' ? null : override) : base[slot];
    if (!owner) continue;
    let list = index.get(owner);
    if (!list) index.set(owner, (list = []));
    list.push(slot);
  }
  ownedCache.set(game, { stamp, index });
  return index;
}

/**
 * Exact cache key. This used to be a digest of the override count plus the last
 * few keys, which could stay identical across a quarter in which cells changed
 * hands both ways — and the map would then draw last quarter's border. A
 * counter cannot be wrong.
 */
function territoryStamp(game) {
  if (!game.territory) game.territory = createTerritory();
  if (typeof game.territory.revision !== 'number') game.territory.revision = 0;
  return game.territory.revision;
}

/** Land-cell slots a country holds right now. */
export function cellsOf(game, ownerId) {
  return ownershipIndex(game).get(ownerId) || [];
}

/** Land area a country holds right now, in thousand km². */
export function areaOf(game, ownerId) {
  const cells = landCells();
  let km2 = 0;
  for (const slot of cellsOf(game, ownerId)) km2 += cellArea(cells[slot]);
  return km2 / 1000;
}

/** The slots a holder started the run with, whoever holds them now. */
export function baseCellsOf(game, ownerId) {
  const base = baseOwners(game?.scenario);
  const slots = [];
  for (let slot = 0; slot < base.length; slot++) {
    if (base[slot] === ownerId) slots.push(slot);
  }
  return slots;
}

/** Baseline land area, in thousand km², for "how much have I lost?" maths. */
export function startingAreaOf(game, ownerId) {
  const base = baseOwners(game?.scenario);
  const cells = landCells();
  let km2 = 0;
  for (let slot = 0; slot < base.length; slot++) {
    if (base[slot] === ownerId) km2 += cellArea(cells[slot]);
  }
  return km2 / 1000;
}

/**
 * Does this country's territory touch water?
 *
 * A land cell with no land cell on one of its four sides is a coast. Used for
 * force structure (nobody landlocked has a navy) and for drawing the fronts a
 * war is actually fought on — a country with a coast has a maritime flank
 * whether it wants one or not.
 */
export function hasCoast(game, ownerId) {
  const mine = cellsOf(game, ownerId);
  if (!mine.length) return false;
  const cells = landCells();
  const slotByIndex = slotLookup();
  for (const slot of mine) {
    const [col, row] = cellColRow(cells[slot]);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = (col + dc + COLS) % COLS;
      const nr = row + dr;
      // Off the top or bottom of the grid is the polar ocean, which counts.
      if (nr < 0 || nr >= ROWS) return true;
      if (slotByIndex.get(cellIndex(nc, nr)) === undefined) return true;
    }
  }
  return false;
}

/** Countries whose territory touches this one's. */
export function neighboursOf(game, ownerId) {
  const mine = new Set(cellsOf(game, ownerId));
  if (!mine.size) return [];
  const cells = landCells();
  const slotByIndex = slotLookup();
  const found = new Set();
  for (const slot of mine) {
    const [col, row] = cellColRow(cells[slot]);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = (col + dc + COLS) % COLS;
      const nr = row + dr;
      if (nr < 0 || nr >= ROWS) continue;
      const neighbourSlot = slotByIndex.get(cellIndex(nc, nr));
      if (neighbourSlot === undefined || mine.has(neighbourSlot)) continue;
      const owner = ownerAt(game, neighbourSlot);
      if (owner && owner !== ownerId) found.add(owner);
    }
  }
  return [...found];
}

let slotCache = null;

/** grid index -> land-cell slot, for neighbour walks. */
function slotLookup() {
  if (slotCache) return slotCache;
  slotCache = new Map();
  const cells = landCells();
  for (let slot = 0; slot < cells.length; slot++) slotCache.set(cells[slot], slot);
  return slotCache;
}

// ── Moving land around ──────────────────────────────────────────────────────

/** Hand specific cells to a new owner (null = leave them unclaimed). */
export function setOwner(game, slots, ownerId) {
  if (!slots.length) return 0;
  const overrides = overridesOf(game);
  const base = baseOwners(game?.scenario);
  const changed = game.territory.changed || (game.territory.changed = {});

  for (const slot of slots) {
    if (base[slot] === ownerId) delete overrides[slot];
    else overrides[slot] = ownerId === null ? '' : ownerId;
    // Which quarter this ground last moved, so the map can show the front.
    changed[slot] = game.turn;
  }

  // Forget anything that has been quiet for a year; the highlight is about
  // what is happening now, and the save should not grow without bound.
  for (const [slot, turn] of Object.entries(changed)) {
    if (game.turn - turn > 4) delete changed[slot];
  }

  game.territory.revision = (game.territory.revision || 0) + 1;
  ownedCache.delete(game);
  return slots.length;
}

/**
 * Cells that changed hands in the last `within` quarters, as [lon, lat] boxes
 * ready to draw. This is the moving front.
 * @returns {Array<{west: number, south: number, east: number, north: number, turn: number}>}
 */
export function recentChanges(game, within = 1) {
  const changed = game?.territory?.changed;
  if (!changed) return [];
  const cells = landCells();
  const out = [];
  for (const [slotKey, turn] of Object.entries(changed)) {
    if (game.turn - turn > within) continue;
    const index = cells[Number(slotKey)];
    if (index === undefined) continue;
    const [col, row] = cellColRow(index);
    const west = GRID.lonMin + col * GRID.step;
    const north = GRID.latMax - row * GRID.step;
    out.push({ west, east: west + GRID.step, north, south: north - GRID.step, turn });
  }
  return out;
}

/**
 * Move land from one holder to another, taking the cells closest to the
 * receiver first — so gains look like an advancing front rather than confetti.
 *
 * @returns {{cells: number[], area: number}} what actually changed hands
 */
export function transferLand(game, fromId, toId, targetKm2, anchor = null, { total = false } = {}) {
  const held = cellsOf(game, fromId);
  if (!held.length || targetKm2 <= 0) return { cells: [], area: 0, emptied: false };
  const cells = landCells();
  const to = anchor || NATIONS_BY_ID[toId] || centroidOf(game, toId);
  if (!to) return { cells: [], area: 0, emptied: false };

  const ranked = held
    .map((slot) => {
      const { lat, lon } = cellCentre(cells[slot]);
      return { slot, d: haversine(lat, lon, to.lat, to.lon) };
    })
    .sort((a, b) => a.d - b.d);

  const taken = [];
  let moved = 0;
  for (const { slot } of ranked) {
    if (moved >= targetKm2) break;
    // Ordinarily a country keeps its last patch of ground: losing a war is not
    // the same as ceasing to exist. `total` is the conquest path, where it is.
    if (!total && held.length - taken.length <= 1) break;
    taken.push(slot);
    moved += cellArea(cells[slot]);
  }
  setOwner(game, taken, toId);
  return { cells: taken, area: moved / 1000, emptied: taken.length >= held.length };
}

/** Hand every cell a country holds to somebody else. Conquest, in one call. */
export function seizeAll(game, fromId, toId) {
  const held = [...cellsOf(game, fromId)];
  if (!held.length) return { cells: [], area: 0 };
  const cells = landCells();
  const area = held.reduce((sum, slot) => sum + cellArea(cells[slot]), 0) / 1000;
  setOwner(game, held, toId);
  return { cells: held, area };
}

/** True when a holder has been pushed off the map entirely. */
export function hasNoLand(game, id) {
  return cellsOf(game, id).length === 0;
}

/**
 * Where an advance should start: the attacker's own ground closest to the
 * defender's heartland. Taking cells outward from here gives a moving front
 * along the shared frontier instead of a rash of pockets.
 */
export function frontAnchor(game, fromId, toId) {
  const defenderCentre = centroidOf(game, fromId);
  const attackerCells = cellsOf(game, toId);
  if (!defenderCentre) return null;
  if (!attackerCells.length) return NATIONS_BY_ID[toId] || null;
  const cells = landCells();
  let best = null;
  let bestD = Infinity;
  for (const slot of attackerCells) {
    const c = cellCentre(cells[slot]);
    const d = haversine(c.lat, c.lon, defenderCentre.lat, defenderCentre.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Geographic centre of what a holder currently owns. */
export function centroidOf(game, ownerId) {
  const slots = cellsOf(game, ownerId);
  if (!slots.length) return NATIONS_BY_ID[ownerId] || null;
  const cells = landCells();
  let lat = 0;
  let lon = 0;
  let x = 0;
  let y = 0;
  for (const slot of slots) {
    const c = cellCentre(cells[slot]);
    lat += c.lat;
    // Average longitudes on the circle so a country astride the date line does
    // not end up centred in the Atlantic.
    x += Math.cos((c.lon * Math.PI) / 180);
    y += Math.sin((c.lon * Math.PI) / 180);
  }
  lat /= slots.length;
  lon = (Math.atan2(y / slots.length, x / slots.length) * 180) / Math.PI;
  return { lat, lon };
}

/**
 * Carve a contiguous-ish chunk off a country, furthest from its capital —
 * the shape a secession takes. Returns the slots without reassigning them.
 */
export function carveOutlyingRegion(game, ownerId, shareOfArea = 0.25) {
  const slots = cellsOf(game, ownerId);
  if (slots.length < 6) return [];
  const cells = landCells();
  const seat = NATIONS_BY_ID[ownerId] || centroidOf(game, ownerId);
  const ranked = slots
    .map((slot) => {
      const { lat, lon } = cellCentre(cells[slot]);
      return { slot, d: haversine(lat, lon, seat.lat, seat.lon) };
    })
    .sort((a, b) => b.d - a.d);

  // Grow from the single furthest cell outward so the breakaway is one region,
  // not a scattering of frontier pixels.
  const seed = ranked[0];
  const seedCentre = cellCentre(cells[seed.slot]);
  const byDistanceFromSeed = slots
    .map((slot) => {
      const { lat, lon } = cellCentre(cells[slot]);
      return { slot, d: haversine(lat, lon, seedCentre.lat, seedCentre.lon) };
    })
    .sort((a, b) => a.d - b.d);

  const wanted = Math.max(3, Math.round(slots.length * shareOfArea));
  return byDistanceFromSeed.slice(0, Math.min(wanted, slots.length - 3)).map((r) => r.slot);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/**
 * Merge a holder's cells into horizontal runs — one rectangle per run.
 * Kept for anything that wants the raw blocks; the map draws outlines instead,
 * because a country made of rectangles reads as graph paper.
 * @returns {Array<{west: number, south: number, east: number, north: number}>}
 */
export function runsFor(game, ownerId) {
  const slots = cellsOf(game, ownerId);
  if (!slots.length) return [];
  const cells = landCells();
  const byRow = new Map();
  for (const slot of slots) {
    const [col, row] = cellColRow(cells[slot]);
    let list = byRow.get(row);
    if (!list) byRow.set(row, (list = []));
    list.push(col);
  }
  const runs = [];
  for (const [row, cols] of byRow) {
    cols.sort((a, b) => a - b);
    let start = cols[0];
    let prev = cols[0];
    for (let i = 1; i <= cols.length; i++) {
      const col = cols[i];
      if (col === prev + 1) {
        prev = col;
        continue;
      }
      const north = GRID.latMax - row * GRID.step;
      runs.push({
        west: GRID.lonMin + start * GRID.step,
        east: GRID.lonMin + (prev + 1) * GRID.step,
        north,
        south: north - GRID.step,
      });
      start = col;
      prev = col;
    }
  }
  return runs;
}

// ── Outlines ────────────────────────────────────────────────────────────────
//
// A cell grid drawn as cells looks like a spreadsheet. What follows turns each
// country's cells into closed rings and then softens them:
//
//   1. Collect the cell edges that face somebody else or the sea.
//   2. Stitch those edges into closed loops.
//   3. Displace every grid corner by a fixed pseudo-random amount, so a border
//      never runs perfectly along a line of latitude. The displacement is a
//      hash of the corner, so neighbouring countries agree on where it moved
//      to and no gap opens between them.
//   4. Round the corners off. The result reads as a frontier rather than a
//      staircase, at no cost in accuracy the grid did not already have.

// How far a grid corner may wander, as a fraction of a cell.
const JITTER = 0.34;
// Corner-cutting passes. Two is smooth; three starts eating small islands.
const SMOOTH_PASSES = 2;

/** Deterministic hash of a grid corner → a stable offset in [-1, 1). */
function vertexNoise(col, row, salt) {
  let h = (col * 73856093) ^ (row * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Where a grid corner actually sits once it has been nudged off the lattice. */
function vertexAt(col, row) {
  return [
    GRID.lonMin + (col + vertexNoise(col, row, 1) * JITTER) * GRID.step,
    GRID.latMax - (row + vertexNoise(col, row, 2) * JITTER) * GRID.step,
  ];
}

const vertexKey = (col, row) => `${col},${row}`;

/**
 * Every closed ring bounding a holder's territory, in lattice coordinates.
 * @returns {Array<Array<[number, number]>>} rings of [col, row] grid corners
 */
function boundaryRings(game, ownerId) {
  const slots = cellsOf(game, ownerId);
  if (!slots.length) return [];
  const cells = landCells();
  const mine = new Set();
  for (const slot of slots) mine.add(cells[slot]);

  const inside = (col, row) => {
    if (row < 0 || row >= ROWS) return false;
    return mine.has(cellIndex((col + COLS) % COLS, row));
  };

  // Directed edges, wound so the interior is always on the same side. Walking
  // them by "the next edge leaving where this one arrived" yields closed rings.
  const outgoing = new Map();
  const addEdge = (from, to) => {
    const key = vertexKey(from[0], from[1]);
    let list = outgoing.get(key);
    if (!list) outgoing.set(key, (list = []));
    list.push(to);
  };

  for (const index of mine) {
    const [col, row] = cellColRow(index);
    if (!inside(col, row - 1)) addEdge([col, row], [col + 1, row]);          // north
    if (!inside(col + 1, row)) addEdge([col + 1, row], [col + 1, row + 1]);  // east
    if (!inside(col, row + 1)) addEdge([col + 1, row + 1], [col, row + 1]);  // south
    if (!inside(col - 1, row)) addEdge([col, row + 1], [col, row]);          // west
  }

  const rings = [];
  for (const startKey of [...outgoing.keys()]) {
    const list = outgoing.get(startKey);
    while (list && list.length) {
      const ring = [];
      const first = startKey.split(',').map(Number);
      let from = first;
      let next = list.shift();
      let guard = 0;

      while (next && guard++ < 40000) {
        ring.push(from);
        from = next;
        if (from[0] === first[0] && from[1] === first[1]) break;
        const outs = outgoing.get(vertexKey(from[0], from[1]));
        if (!outs || !outs.length) break;
        next = outs.shift();
      }
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

/** Chaikin corner cutting on a closed ring. */
function smoothRing(points, passes = SMOOTH_PASSES) {
  let ring = points;
  for (let pass = 0; pass < passes; pass++) {
    if (ring.length < 4) break;
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      out.push([ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25]);
      out.push([ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75]);
    }
    ring = out;
  }
  return ring;
}

/**
 * A holder's territory as smooth closed rings in degrees, ready to draw.
 *
 * Rings that wrap the date line are cut, because a polygon that runs off one
 * edge of an equirectangular map and back on at the other draws a stripe across
 * the whole world.
 *
 * @returns {Array<Array<[number, number]>>} rings of [lon, lat]
 */
const outlineCache = new WeakMap();

export function outlineFor(game, ownerId) {
  // Tracing and smoothing is the most expensive thing the map does, and the
  // answer only changes when a cell changes hands.
  const stamp = territoryStamp(game);
  let cached = outlineCache.get(game);
  if (!cached || cached.stamp !== stamp) {
    cached = { stamp, rings: new Map() };
    outlineCache.set(game, cached);
  }
  if (cached.rings.has(ownerId)) return cached.rings.get(ownerId);

  const out = [];
  for (const ring of boundaryRings(game, ownerId)) {
    const positioned = ring.map(([col, row]) => vertexAt(col, row));
    for (const piece of splitAtDateLine(smoothRing(positioned))) {
      if (piece.length >= 3) out.push(piece);
    }
  }
  cached.rings.set(ownerId, out);
  return out;
}

/** Cut a ring wherever consecutive points jump most of the way round the globe. */
function splitAtDateLine(ring) {
  const pieces = [];
  let current = [];
  for (let i = 0; i < ring.length; i++) {
    const point = ring[i];
    const previous = ring[i - 1];
    if (previous && Math.abs(point[0] - previous[0]) > 180) {
      if (current.length) pieces.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) pieces.push(current);
  return pieces;
}

/** Every holder that currently owns ground, largest first. */
export function holders(game) {
  return [...ownershipIndex(game).keys()].sort(
    (a, b) => cellsOf(game, b).length - cellsOf(game, a).length,
  );
}
