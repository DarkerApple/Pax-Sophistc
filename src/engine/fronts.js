// A war is not one number.
//
// `warScore` ran from −100 to +100 and every order in the War Room nudged it.
// That is a tug of war, not a campaign: there was no *where*, so there was
// nothing to choose between, and an armoured thrust was worth the same in the
// Carpathians as it was on the Polish plain.
//
// A war is now two to four named fronts, drawn from the ground the two sides
// actually share: the sectors of their land border, split north from south; a
// maritime flank if either of them has a coast; and an air campaign over the
// whole thing once both sides have aircraft. Each front has terrain, and the
// terrain decides what an arm is worth there — armour is decisive on plains and
// nearly useless in mountains, artillery owns a city, a navy is worth nothing
// at all inland. Each front has its own line, and the lines move independently.
//
// This is what makes "where do I attack" a question. It is also what makes
// losing slow: a front that breaks is one front, and the ground behind it is
// somebody's home, which is defended harder the less of it there is left.

import { t, tNation } from '../i18n/index.js';
import { clamp, defOf } from './state.js';
import { ARMS_BY_ID, available, consume, strengthOf } from './arsenal.js';
import {
  COLS,
  GRID,
  ROWS,
  cellCentre,
  cellIndex,
  cellsOf,
  hasCoast,
  landCells,
  ownerAt,
} from './territory.js';
import { theatreOf } from './reach.js';

/**
 * What each kind of ground does to each arm of service.
 *
 * These are the numbers the whole system is about. An offensive that sends
 * armour into mountains is not unlucky, it is wrong, and the planner shows the
 * multiplier before the order is given.
 */
export const TERRAIN = {
  plain: {
    id: 'plain', name: 'open country', icon: '▤',
    blurb: 'Room to manoeuvre, nowhere to hide. Whoever has the armour decides this.',
    arms: { armour: 1.7, infantry: 0.85, artillery: 1.15, drones: 1.1, airpower: 1.2, special: 0.8, logistics: 1.1 },
    defence: 0.9,
  },
  mountain: {
    id: 'mountain', name: 'high ground', icon: '▲',
    blurb: 'A road, a pass, and a company that can hold either against a division.',
    arms: { armour: 0.35, infantry: 1.35, artillery: 1.2, special: 1.6, airpower: 0.75, logistics: 0.7, drones: 1.2 },
    defence: 1.5,
  },
  urban: {
    id: 'urban', name: 'the built-up belt', icon: '▦',
    blurb: 'Every street is a position. It costs an army a week to take a suburb.',
    arms: { armour: 0.55, infantry: 1.45, artillery: 1.4, special: 1.3, airpower: 0.7, drones: 1.3, logistics: 0.8 },
    defence: 1.6,
  },
  forest: {
    id: 'forest', name: 'the forest belt', icon: '⋔',
    blurb: 'Nobody sees anything. Infantry and artillery decide it, slowly.',
    arms: { armour: 0.6, infantry: 1.3, artillery: 1.15, special: 1.35, airpower: 0.65, drones: 0.9 },
    defence: 1.35,
  },
  river: {
    id: 'river', name: 'the river line', icon: '≋',
    blurb: 'One obstacle, a handful of crossings, and everything depends on the bridging train.',
    arms: { armour: 0.7, infantry: 1.15, artillery: 1.3, logistics: 1.5, special: 1.2, airpower: 1.1 },
    defence: 1.45,
  },
  desert: {
    id: 'desert', name: 'the open flank', icon: '⋯',
    blurb: 'Nothing to hold and nothing to hide behind. Fuel and water decide it.',
    arms: { armour: 1.6, logistics: 1.6, airpower: 1.35, infantry: 0.7, artillery: 1, drones: 1.2 },
    defence: 0.8,
  },
  littoral: {
    id: 'littoral', name: 'the coastal sector', icon: '⌒',
    blurb: 'A shore, a port, and a flank that can be turned by anybody with ships.',
    arms: { navy: 1.9, airpower: 1.3, infantry: 1, armour: 0.75, artillery: 1.05, special: 1.2, logistics: 1.2 },
    defence: 1.1,
  },
  sea: {
    id: 'sea', name: 'the sea lanes', icon: '≈',
    blurb: 'No ground changes hands here. What changes is whether anything gets through.',
    arms: { navy: 2.6, airpower: 1.5, missiles: 1.4, drones: 1.1, airDefence: 0.8, infantry: 0.05, armour: 0.02, artillery: 0.05, special: 0.5, logistics: 0.7 },
    defence: 1,
    noGround: true,
  },
  air: {
    id: 'air', name: 'the air campaign', icon: '✧',
    blurb: 'Won or lost above everything else, and it decides how much the rest costs.',
    arms: { airpower: 2.4, airDefence: 2.1, missiles: 1.6, drones: 1.4, special: 0.6, infantry: 0.05, armour: 0.05, artillery: 0.2, navy: 0.6, logistics: 0.5 },
    defence: 1,
    noGround: true,
  },
};

/** Which sector names go with which bearing, so a front reads like a place. */
const BEARINGS = [
  { from: -22.5, to: 22.5, key: 'northern', name: 'the northern axis' },
  { from: 22.5, to: 67.5, key: 'northeastern', name: 'the north-eastern approaches' },
  { from: 67.5, to: 112.5, key: 'eastern', name: 'the eastern front' },
  { from: 112.5, to: 157.5, key: 'southeastern', name: 'the south-eastern salient' },
  { from: 157.5, to: 202.5, key: 'southern', name: 'the southern axis' },
  { from: 202.5, to: 247.5, key: 'southwestern', name: 'the south-western approaches' },
  { from: 247.5, to: 292.5, key: 'western', name: 'the western front' },
  { from: 292.5, to: 337.5, key: 'northwestern', name: 'the north-western salient' },
];

/** Names for the two halves of a frontier that bears the same way from both. */
const SPLIT = {
  north: { key: 'northSector', name: 'the northern sector' },
  south: { key: 'southSector', name: 'the southern sector' },
  east: { key: 'eastSector', name: 'the eastern sector' },
  west: { key: 'westSector', name: 'the western sector' },
};

function bearingOf(fromLat, fromLon, toLat, toLon) {
  const dLon = ((toLon - fromLon + 540) % 360) - 180;
  const angle = (Math.atan2(dLon, toLat - fromLat) * 180) / Math.PI;
  return (angle + 360) % 360;
}

function bearingName(angle) {
  return BEARINGS.find((b) =>
    b.from < b.to ? angle >= b.from && angle < b.to : angle >= b.from || angle < b.to,
  ) || BEARINGS[0];
}

/**
 * The terrain of a stretch of ground, inferred from where it is.
 *
 * Deterministic and derived rather than authored: latitude gives the forest and
 * desert belts, a country's own tags give its cities and its mountains, and a
 * shared river or a mountain chain shows up as the frontier between two
 * countries whose centres are close but whose borders are long.
 */
function terrainFor(game, aId, bId, lat, lon, salt = 0) {
  const tags = [...(defOf(game, aId)?.tags || []), ...(defOf(game, bId)?.tags || [])].join(' ');
  const absLat = Math.abs(lat);

  if (/mountain|himalaya|caucasus|andes|alpine/.test(tags)) return TERRAIN.mountain;
  // The great deserts, by latitude band and longitude: the Sahara and Arabia,
  // the Thar, and the Australian interior — which is in the other hemisphere,
  // so the band has to be signed rather than absolute.
  if (absLat > 14 && absLat < 34 && ((lon > -18 && lon < 58) || (lon > 60 && lon < 78))) {
    return TERRAIN.desert;
  }
  if (lat < -18 && lat > -32 && lon > 118 && lon < 142) return TERRAIN.desert;
  // The boreal and temperate forest belts.
  if (absLat > 47) return salt % 2 === 0 ? TERRAIN.forest : TERRAIN.plain;
  // A dense, urbanised frontier.
  if (/megacity|urban|delta|entrepot|trade-hub|nearshoring/.test(tags) && salt % 3 === 0) return TERRAIN.urban;
  if (/renaissance-dam|grain-corridor|delta|riverine|amazon/.test(tags) && salt % 2 === 1) return TERRAIN.river;
  if (absLat < 12) return salt % 2 === 0 ? TERRAIN.forest : TERRAIN.plain;
  return salt % 3 === 0 ? TERRAIN.river : TERRAIN.plain;
}

/**
 * Every point at which two countries' territory actually touches.
 *
 * Walked on the grid rather than by comparing every cell to every other cell:
 * a pair of continental neighbours has tens of thousands of cell pairs and only
 * a few dozen of them are a border.
 */
function frontier(game, aId, bId) {
  const mine = cellsOf(game, aId);
  if (!mine.length) return null;
  const cells = landCells();
  const points = [];
  for (const slot of mine) {
    const here = cellCentre(cells[slot]);
    for (const [dLat, dLon] of [[GRID.step, 0], [-GRID.step, 0], [0, GRID.step], [0, -GRID.step]]) {
      const owner = ownerAtPoint(game, here.lat + dLat, here.lon + dLon);
      if (owner !== bId) continue;
      points.push({ lat: here.lat + dLat / 2, lon: here.lon + dLon / 2 });
    }
  }
  return points.length ? points : null;
}

/** Who holds the land cell containing this point, if any. */
function ownerAtPoint(game, lat, lon) {
  const col = Math.floor((((lon + 180) % 360) - 0 + 360) % 360 / GRID.step);
  const row = Math.floor((GRID.latMax - lat) / GRID.step);
  if (row < 0 || row >= ROWS) return null;
  const slot = slotFor(cellIndex(((col % COLS) + COLS) % COLS, row));
  return slot === undefined ? null : ownerAt(game, slot);
}

let slotIndex = null;
function slotFor(index) {
  if (!slotIndex) {
    slotIndex = new Map();
    const cells = landCells();
    for (let slot = 0; slot < cells.length; slot++) slotIndex.set(cells[slot], slot);
  }
  return slotIndex.get(index);
}

/**
 * Draw the fronts of a war.
 *
 * Called once, at the declaration, and stored on the war: a campaign whose
 * geography changed every quarter would be unplayable.
 */
export function drawFronts(game, war) {
  const attacker = war.attackers[0];
  const defender = theatreOf(game, war) || war.defenders[0];
  const fronts = [];

  const shared = frontier(game, attacker, defender);
  const defDef = defOf(game, defender);
  const atkDef = defOf(game, attacker);

  if (shared && shared.length) {
    // Split the shared border in two along its longer axis, so a long frontier
    // becomes a northern and a southern sector rather than one undifferentiated
    // line — which is the whole point of being able to choose.
    const lats = shared.map((p) => p.lat);
    const lons = shared.map((p) => p.lon);
    const spreadLat = Math.max(...lats) - Math.min(...lats);
    const spreadLon = Math.max(...lons) - Math.min(...lons);
    const byLat = spreadLat >= spreadLon;
    const sorted = [...shared].sort((p, q) => (byLat ? p.lat - q.lat : p.lon - q.lon));
    const halves = [sorted.slice(0, Math.ceil(sorted.length / 2)), sorted.slice(Math.ceil(sorted.length / 2))];

    halves.forEach((half, i) => {
      if (!half.length) return;
      const lat = half.reduce((s, p) => s + p.lat, 0) / half.length;
      const lon = half.reduce((s, p) => s + p.lon, 0) / half.length;
      const bearing = bearingName(bearingOf(defDef?.lat ?? lat, defDef?.lon ?? lon, lat, lon));
      const terrain = terrainFor(game, attacker, defender, lat, lon, i);
      // Both halves of a short frontier can bear the same way from the capital,
      // and two fronts called "the northern axis" is not a choice. When that
      // happens they take their names from the axis they were split on.
      const twin = fronts.some((f) => f.name === bearing.name);
      const named = twin
        ? (byLat
            ? (i === 0 ? SPLIT.south : SPLIT.north)
            : (i === 0 ? SPLIT.west : SPLIT.east))
        : bearing;
      fronts.push(makeFront(`land-${i}`, named.name, terrain, lat, lon, 0.44, named.key));
    });
  }

  // No shared border: the war has to be got to, so it is fought over water and
  // in the air, and the ground fighting is whatever can be put ashore.
  if (!fronts.length) {
    fronts.push(makeFront('landing', 'the beachhead', TERRAIN.littoral,
      defDef?.lat ?? 0, defDef?.lon ?? 0, 0.5, 'beachhead'));
  }

  // A maritime flank, if there is a coast to turn.
  if (hasCoast(game, defender) || hasCoast(game, attacker)) {
    fronts.push(makeFront('sea', 'the sea lanes', TERRAIN.sea,
      defDef?.lat ?? 0, (defDef?.lon ?? 0) + 6, 0.22, 'seaLanes'));
  }

  // And the air, always — it is where a technological edge shows up first.
  fronts.push(makeFront('air', 'the air campaign', TERRAIN.air,
    defDef?.lat ?? 0, defDef?.lon ?? 0, 0.2, 'airCampaign'));

  // Normalise the weights so the fronts add up to the war.
  const total = fronts.reduce((sum, f) => sum + f.width, 0) || 1;
  for (const front of fronts) front.width = Number((front.width / total).toFixed(3));
  return fronts;
}

function makeFront(id, name, terrain, lat, lon, width, nameKey = id) {
  return {
    id,
    name,
    // A stable key for the name, so "the northern axis" can be said in Korean.
    // The id cannot do this job: land-0 is a position, not a place.
    nameKey,
    terrainId: terrain.id,
    lat: Number(lat.toFixed(2)),
    lon: Number(lon.toFixed(2)),
    width,
    // −100 (defenders pushing) to +100 (attackers through). Its own tug of war,
    // one per sector.
    line: 0,
    // What each side has standing on it, as {armId: count}. Committed force
    // stays until it is withdrawn or destroyed, so a plan is a commitment.
    committed: { attackers: {}, defenders: {} },
    supply: { attackers: 100, defenders: 100 },
    casualties: 0,
    // Set by an offensive; decays. Surprise is worth a great deal once.
    momentum: 0,
    quiet: 0,
  };
}

/** The fronts of a war, drawn on first use so old saves keep working. */
export function frontsOf(game, war) {
  if (!war) return [];
  if (!war.fronts || !war.fronts.length) war.fronts = drawFronts(game, war);
  return war.fronts;
}

export function frontById(game, war, frontId) {
  return frontsOf(game, war).find((f) => f.id === frontId) || null;
}

export function terrainOf(front) {
  return TERRAIN[front?.terrainId] || TERRAIN.plain;
}

/**
 * What a committed mix is worth on this particular ground.
 *
 * The heart of it: strength × terrain multiplier, arm by arm. Sending armour
 * into the mountains is not bad luck.
 */
export function mixStrength(game, id, front, mix) {
  const terrain = terrainOf(front);
  let total = 0;
  for (const [armId, count] of Object.entries(mix || {})) {
    if (count <= 0) continue;
    const factor = terrain.arms[armId] ?? 1;
    total += strengthOf(game, id, armId, count) * factor;
  }
  return total;
}

/**
 * How well suited a mix is to a front, 0–2, for the planner to show before the
 * order is given. 1 is "about what you would expect"; below 0.7 is a mistake.
 */
export function suitability(game, id, front, mix) {
  const terrain = terrainOf(front);
  let weighted = 0;
  let flat = 0;
  for (const [armId, count] of Object.entries(mix || {})) {
    if (count <= 0) continue;
    const raw = strengthOf(game, id, armId, count);
    flat += raw;
    weighted += raw * (terrain.arms[armId] ?? 1);
  }
  return flat > 0 ? Number((weighted / flat).toFixed(2)) : 0;
}

/** Everything standing on a front, both sides, as a strength comparison. */
export function balanceOf(game, war, front) {
  const attackers = mixStrength(game, war.attackers[0], front, front.committed.attackers)
    * (front.supply.attackers / 100);
  const defenders = mixStrength(game, war.defenders[0], front, front.committed.defenders)
    * (front.supply.defenders / 100) * terrainOf(front).defence;
  return { attackers, defenders, ratio: attackers / Math.max(1, defenders) };
}

/**
 * Put force on a front.
 *
 * Committed force is taken out of the arsenal's available pool for as long as
 * it is there, which is what makes a two-front war a real problem rather than
 * a cosmetic one.
 */
export function commit(game, war, front, side, mix) {
  const standing = front.committed[side] || (front.committed[side] = {});
  const placed = {};
  const ownerId = war[side][0];
  for (const [armId, count] of Object.entries(mix || {})) {
    if (!ARMS_BY_ID[armId] || count <= 0) continue;
    const spare = available(game, ownerId, armId) - committedTotal(game, war, ownerId, armId);
    const going = Math.max(0, Math.min(count, spare));
    if (!going) continue;
    standing[armId] = (standing[armId] || 0) + going;
    placed[armId] = going;
  }
  return placed;
}

/** How much of one arm this country already has standing on fronts somewhere. */
export function committedTotal(game, warOrNull, ownerId, armId) {
  let total = 0;
  for (const war of game.wars) {
    if (!war.active || !war.fronts) continue;
    const side = war.attackers.includes(ownerId) ? 'attackers'
      : war.defenders.includes(ownerId) ? 'defenders' : null;
    if (!side) continue;
    for (const front of war.fronts) total += front.committed[side]?.[armId] || 0;
  }
  return total;
}

/** Everything this country has standing on fronts, by arm. */
export function deployed(game, ownerId) {
  const out = {};
  for (const war of game.wars) {
    if (!war.active || !war.fronts) continue;
    const side = war.attackers.includes(ownerId) ? 'attackers'
      : war.defenders.includes(ownerId) ? 'defenders' : null;
    if (!side) continue;
    for (const front of war.fronts) {
      for (const [armId, count] of Object.entries(front.committed[side] || {})) {
        out[armId] = (out[armId] || 0) + count;
      }
    }
  }
  return out;
}

/** Take force off a front. It goes back into the pool, minus what it left behind. */
export function withdraw(game, war, front, side, share = 1) {
  const standing = front.committed[side] || {};
  const pulled = {};
  for (const [armId, count] of Object.entries(standing)) {
    const going = Math.round(count * share);
    if (going <= 0) continue;
    standing[armId] = count - going;
    if (standing[armId] <= 0) delete standing[armId];
    pulled[armId] = going;
  }
  return pulled;
}

/**
 * Every army mans its own line.
 *
 * Not a plan, a garrison: each side fills each front to a share of what it has,
 * weighted by how wide the sector is and what the ground rewards. This runs for
 * the player too — an army defends its own frontier whether or not the head of
 * state gave an order about it, and a player who spends a quarter on the economy
 * should not find their country undefended.
 *
 * It deliberately stops short of the whole arsenal. What is left over is what
 * an offensive has to work with, which is what makes committing to one a real
 * decision rather than a free one.
 */
export const GARRISON_SHARE = 0.45;

export function garrison(game, war, side) {
  const ownerId = war[side][0];
  if (!ownerId) return;
  const fronts = frontsOf(game, war);
  for (const front of fronts) {
    const terrain = terrainOf(front);
    const standing = front.committed[side] || (front.committed[side] = {});
    for (const armId of Object.keys(ARMS_BY_ID)) {
      const factor = terrain.arms[armId] ?? 1;
      if (factor < 0.35) continue;
      const pool = available(game, ownerId, armId);
      const want = Math.floor(pool * front.width * suitableCap(factor) * GARRISON_SHARE);
      const spare = pool - committedTotal(game, war, ownerId, armId);
      const going = Math.max(0, Math.min(want - (standing[armId] || 0), spare));
      if (going > 0) standing[armId] = (standing[armId] || 0) + going;
    }
  }
}

/** Terrain suitability, capped, so a garrison leans toward what works there. */
function suitableCap(factor) {
  return Math.min(1.3, factor);
}

/**
 * Advance every front one quarter.
 *
 * Each sector is fought on its own terms and its line moves on its own. The
 * war's headline score is what the fronts add up to, so it still means
 * something — it is simply no longer the only thing that exists.
 *
 * @returns {Array<object>} one entry per front that did something worth saying
 */
export function tickFronts(game, war, rng, mods) {
  const fronts = frontsOf(game, war);
  const notes = [];

  // Everybody who is not the player mans their line.
  garrison(game, war, 'attackers');
  garrison(game, war, 'defenders');

  for (const front of fronts) {
    const balance = balanceOf(game, war, front);
    const terrain = terrainOf(front);

    // An empty front is a quiet front, and a quiet front slowly reverts.
    if (balance.attackers < 1 && balance.defenders < 1) {
      front.quiet += 1;
      front.line = clamp(front.line * 0.9, -100, 100);
      front.momentum = 0;
      continue;
    }
    front.quiet = 0;

    // Log ratio again, so overwhelming force overwhelms rather than saturating.
    const ratio = Math.log2(Math.max(0.05, balance.ratio));
    const swing = Math.max(-26, Math.min(26, ratio * 11 + front.momentum)) + rng.normal(0, 3.4);
    front.line = clamp(front.line + swing, -100, 100);
    front.momentum *= 0.45;

    // Both sides pay in materiel, in proportion to how hard it was.
    const intensity = clamp(0.55 + Math.abs(ratio) * 0.3, 0.4, 1.9);
    const attackerLoss = consume(game, war.attackers[0], front.committed.attackers,
      intensity * (front.line < 0 ? 1.25 : 0.85) * (mods?.eventSeverity ?? 1), rng);
    const defenderLoss = consume(game, war.defenders[0], front.committed.defenders,
      intensity * (front.line > 0 ? 1.25 : 0.85) * terrain.defence * 0.8 * (mods?.eventSeverity ?? 1), rng);
    // Losses come off the front as well as out of the arsenal.
    strip(front.committed.attackers, attackerLoss);
    strip(front.committed.defenders, defenderLoss);

    const fell = Object.values(attackerLoss).reduce((s, n) => s + n, 0)
      + Object.values(defenderLoss).reduce((s, n) => s + n, 0);
    front.casualties += Math.round(fell * rng.float(900, 2200));

    // Supply degrades where logistics are thin, which is what actually stops
    // an offensive.
    for (const side of ['attackers', 'defenders']) {
      const lift = front.committed[side]?.logistics || 0;
      const mass = Object.values(front.committed[side] || {}).reduce((s, n) => s + n, 0);
      const need = Math.max(1, mass * 0.18);
      front.supply[side] = Math.round(clamp(
        front.supply[side] + (lift >= need ? 6 : -9) * (terrain.arms.logistics ?? 1), 20, 100,
      ));
    }

    if (Math.abs(swing) >= 9) {
      notes.push({
        frontId: front.id,
        name: front.name,
        terrain: terrain.id,
        line: Math.round(front.line),
        swing: Math.round(swing),
        casualties: front.casualties,
      });
    }
  }

  // The war's headline is the width-weighted average of its sectors.
  const weighted = fronts.reduce((sum, f) => sum + f.line * f.width, 0);
  war.warScore = clamp(weighted, -100, 100);
  return notes;
}

function strip(standing, losses) {
  for (const [armId, lost] of Object.entries(losses || {})) {
    if (!standing[armId]) continue;
    standing[armId] = Math.max(0, standing[armId] - lost);
    if (!standing[armId]) delete standing[armId];
  }
}

/**
 * Which front is actually broken open, if any — the one the ground moves on.
 *
 * A war takes territory through a sector that has given way, not through an
 * average. Sea and air fronts never move ground however decisively they go.
 */
export function breakthrough(game, war) {
  let best = null;
  for (const front of frontsOf(game, war)) {
    if (terrainOf(front).noGround) continue;
    const magnitude = Math.abs(front.line);
    if (magnitude < 22) continue;
    if (!best || magnitude > Math.abs(best.line)) best = front;
  }
  return best;
}

// ── Offensives ──────────────────────────────────────────────────────────────

/**
 * What an offensive on this front with this mix would look like, before it is
 * ordered.
 *
 * The planner shows every line of this, because the entire point of choosing
 * where to attack and what to send is being able to see that armour in the
 * mountains is a mistake *before* the armour is in the mountains.
 *
 * @returns {{chance, ratio, suitability, supply, factors, terrain}}
 */
export function offensiveOdds(game, war, front, side, mix) {
  const terrain = terrainOf(front);
  const ownerId = war[side][0];
  const otherSide = side === 'attackers' ? 'defenders' : 'attackers';
  const enemyId = war[otherSide][0];

  const standing = front.committed[side] || {};
  const combined = { ...standing };
  for (const [armId, count] of Object.entries(mix || {})) {
    combined[armId] = (combined[armId] || 0) + count;
  }

  const mine = mixStrength(game, ownerId, front, combined) * (front.supply[side] / 100);
  const theirs = mixStrength(game, enemyId, front, front.committed[otherSide] || {})
    * (front.supply[otherSide] / 100) * terrain.defence;
  const ratio = mine / Math.max(1, theirs);
  const fit = suitability(game, ownerId, front, mix);

  // Lift is what turns a plan into an offensive. Without it you get a raid.
  const mass = Object.values(mix || {}).reduce((sum, n) => sum + n, 0);
  const lift = (mix?.logistics || 0) + (standing.logistics || 0) * 0.5;
  const sustained = Math.min(1.2, 0.5 + lift / Math.max(1, mass * 0.2) * 0.5);

  const factors = [
    { id: 'ratio', label: 'the local balance', value: Math.max(-0.38, Math.min(0.4, Math.log2(Math.max(0.06, ratio)) * 0.26)) },
    { id: 'terrain', label: 'the ground you chose', value: (fit - 1) * 0.34 },
    { id: 'supply', label: 'what you can keep supplied', value: (sustained - 0.85) * 0.5 },
    { id: 'defence', label: 'what the ground gives them', value: -(terrain.defence - 1) * 0.22 },
    { id: 'momentum', label: 'the state of the front', value: Math.max(-0.14, Math.min(0.14, (side === 'attackers' ? front.line : -front.line) / 420)) },
  ];

  // At parity, on ground that suits you, with the lift to sustain it, an
  // offensive is a coin toss. Everything above is what moves it off that.
  const chance = clamp(0.47 + factors.reduce((sum, f) => sum + f.value, 0), 0.04, 0.94);
  return {
    chance: Number(chance.toFixed(2)),
    ratio: Number(ratio.toFixed(2)),
    suitability: fit,
    supply: Number(sustained.toFixed(2)),
    terrain,
    factors: factors
      .filter((f) => Math.abs(f.value) >= 0.015)
      .map((f) => ({ ...f, value: Number(f.value.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  };
}

/**
 * Order it.
 *
 * The mix is committed to the front — it stays there afterwards, which is what
 * makes an offensive a commitment rather than a button — and then the roll
 * decides whether the line moves or the materiel was simply spent.
 */
export function mountOffensive(game, war, frontId, side, mix, rng, { pressure = 1 } = {}) {
  const front = frontById(game, war, frontId);
  if (!front) return null;
  const odds = offensiveOdds(game, war, front, side, mix);
  const placed = commit(game, war, front, side, mix);
  const ownerId = war[side][0];

  const roll = rng.next();
  const margin = odds.chance - roll;
  const tier = margin > 0.28 ? 'breakthrough'
    : margin > 0 ? 'gains'
      : margin > -0.2 ? 'grinding'
        : 'repulsed';

  const sign = side === 'attackers' ? 1 : -1;
  const move = { breakthrough: 26, gains: 13, grinding: 3, repulsed: -11 }[tier];
  front.line = clamp(front.line + move * sign * pressure, -100, 100);
  front.momentum += { breakthrough: 9, gains: 5, grinding: 1, repulsed: -6 }[tier];

  // An offensive is expensive whether or not it works, and dearer when it does
  // not — that is the whole risk of ordering one.
  const intensity = { breakthrough: 0.9, gains: 1.1, grinding: 1.4, repulsed: 1.9 }[tier];
  const losses = consume(game, ownerId, placed, intensity, rng);
  strip(front.committed[side], losses);
  const enemyLosses = consume(game, war[side === 'attackers' ? 'defenders' : 'attackers'][0],
    front.committed[side === 'attackers' ? 'defenders' : 'attackers'] || {},
    { breakthrough: 1.7, gains: 1.2, grinding: 0.9, repulsed: 0.5 }[tier], rng);
  strip(front.committed[side === 'attackers' ? 'defenders' : 'attackers'], enemyLosses);

  const dead = Object.values(losses).reduce((s, n) => s + n, 0)
    + Object.values(enemyLosses).reduce((s, n) => s + n, 0);
  const casualties = Math.round(dead * rng.float(1400, 3400));
  front.casualties += casualties;
  war.casualties += casualties;

  return {
    frontId: front.id,
    frontName: front.name,
    terrain: odds.terrain.id,
    tier,
    chance: odds.chance,
    suitability: odds.suitability,
    committed: placed,
    losses,
    enemyLosses,
    casualties,
    line: Math.round(front.line),
  };
}

// ── For the interface ───────────────────────────────────────────────────────

/** Every front of a war, with everything the War Room needs to draw it. */
export function frontReport(game, war, viewerId = game.playerId) {
  const side = war.attackers.includes(viewerId) ? 'attackers'
    : war.defenders.includes(viewerId) ? 'defenders' : null;
  const other = side === 'attackers' ? 'defenders' : 'attackers';

  return frontsOf(game, war).map((front) => {
    const terrain = terrainOf(front);
    const balance = balanceOf(game, war, front);
    // The line as *you* read it: positive is your way, whichever side you are.
    const mine = side === 'defenders' ? -front.line : front.line;
    return {
      ...front,
      terrain,
      terrainName: t(`terrain.${terrain.id}`, terrain.name),
      label: frontName(front),
      mine: Math.round(mine),
      balance,
      yours: side ? front.committed[side] || {} : {},
      theirs: side ? front.committed[other] || {} : {},
      yourStrength: side ? Math.round(mixStrength(game, viewerId, front, front.committed[side] || {})) : 0,
      theirStrength: side
        ? Math.round(mixStrength(game, war[other][0], front, front.committed[other] || {}))
        : 0,
      supplyYours: side ? front.supply[side] : 100,
      state: mine > 40 ? 'breaking-through'
        : mine > 12 ? 'advancing'
          : mine > -12 ? 'held'
            : mine > -40 ? 'giving-ground'
              : 'collapsing',
    };
  });
}

/** A front's name in the player's language. */
export function frontName(front) {
  return t(`frontName.${front?.nameKey || front?.id}`, front?.name || '');
}

/** A short human line about a front, for the briefing. */
export function describeFront(game, war, front) {
  const terrain = terrainOf(front);
  const holder = front.line > 12 ? war.attackers[0] : front.line < -12 ? war.defenders[0] : null;
  if (!holder) {
    return t('front.stalled', 'On {front} — {terrain} — neither side has moved.', {
      front: frontName(front), terrain: t(`terrain.${terrain.id}`, terrain.name),
    });
  }
  return t('front.moving', '{who} is gaining on {front}, {terrain}.', {
    who: tNation(defOf(game, holder)),
    front: frontName(front),
    terrain: t(`terrain.${terrain.id}`, terrain.name),
  });
}
