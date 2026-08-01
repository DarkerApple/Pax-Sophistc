// The land layer: who holds what, and what happens when it moves.

import test from 'node:test';
import assert from 'node:assert/strict';

import { NATIONS } from '../src/data/nations.js';
import {
  createGame,
  deserialize,
  rankedNations,
  serialize,
  sovereignIds,
} from '../src/engine/state.js';
import { advanceTurn } from '../src/engine/turn.js';
import { Rng } from '../src/engine/rng.js';
import { annexOccupied, concludeWar, declareWar } from '../src/engine/war.js';
import { reconcileSovereignty } from '../src/engine/statecraft.js';
import {
  areaOf,
  baseOwners,
  carveOutlyingRegion,
  cellArea,
  cellCentre,
  cellsOf,
  centroidOf,
  createTerritory,
  frontAnchor,
  holders,
  landCells,
  neighboursOf,
  outlineFor,
  ownerAt,
  runsFor,
  seizeAll,
  setOwner,
  startingAreaOf,
  transferLand,
} from '../src/engine/territory.js';

const fresh = () => createGame({ playerNationId: 'kor', seed: 'land' });

test('the continents rasterise into a plausible amount of land', () => {
  const cells = landCells();
  assert.ok(cells.length > 8000, `only ${cells.length} land cells`);
  // Earth's land is ~149M km²; ours excludes Antarctica and every small island.
  const km2 = cells.reduce((sum, index) => sum + cellArea(index), 0);
  assert.ok(km2 > 90e6 && km2 < 160e6, `implausible land area: ${Math.round(km2 / 1e6)}M km²`);
  assert.deepEqual([...cells].sort((a, b) => a - b), cells, 'cells must stay ascending');
});

test('every country on the roster holds ground it can actually see', () => {
  const game = fresh();
  for (const nation of NATIONS) {
    assert.ok(cellsOf(game, nation.id).length > 0, `${nation.id} holds no territory`);
  }
});

test('claimed area lands near each country\'s real area', () => {
  const game = fresh();
  // Countries bigger than one grid cell should be within a factor of ~2.5.
  // Below that the grid itself is the error term, so they are exempt.
  const off = [];
  for (const nation of NATIONS) {
    if (nation.area < 200) continue;
    const ratio = areaOf(game, nation.id) / nation.area;
    if (ratio > 2.5 || ratio < 0.4) off.push(`${nation.id} ${ratio.toFixed(2)}×`);
  }
  assert.ok(off.length <= 3, `too many badly sized countries: ${off.join(', ')}`);
});

test('land nobody on the roster can reach is left unclaimed', () => {
  const unclaimed = baseOwners().filter((o) => o === null).length;
  // Roughly a hundred and thirty real countries are not on the roster, so a
  // sizeable share of the map has to belong to nobody.
  assert.ok(unclaimed > 500, 'no unclaimed land at all');
  assert.ok(unclaimed / baseOwners().length < 0.5, 'more than half the world is unclaimed');
});

test('neighbours are the countries you actually share a border with', () => {
  const game = fresh();
  const koreanNeighbours = neighboursOf(game, 'kor');
  assert.ok(koreanNeighbours.includes('prk'), 'Korea must border North Korea');
  assert.ok(!koreanNeighbours.includes('bra'), 'Korea does not border Brazil');
  assert.ok(neighboursOf(game, 'aus').length <= 2, 'an island has few or no land neighbours');
});

test('a fresh game stores no territory deltas at all', () => {
  const game = fresh();
  assert.deepEqual(game.territory.overrides, {});
  // …and a save stays small because of it.
  assert.ok(serialize(game).length < 400_000, 'save file is too large');
});

test('moving land changes the owner and survives a save round-trip', () => {
  const game = fresh();
  const before = areaOf(game, 'prk');
  const moved = transferLand(game, 'prk', 'kor', 20_000, frontAnchor(game, 'prk', 'kor'));

  assert.ok(moved.cells.length > 0, 'nothing changed hands');
  assert.ok(areaOf(game, 'prk') < before, 'the loser must actually lose ground');
  for (const slot of moved.cells) assert.equal(ownerAt(game, slot), 'kor');

  const restored = deserialize(serialize(game));
  for (const slot of moved.cells) assert.equal(ownerAt(restored, slot), 'kor');
  assert.equal(Math.round(areaOf(restored, 'kor')), Math.round(areaOf(game, 'kor')));
});

test('handing land back removes the delta rather than recording another', () => {
  const game = fresh();
  const moved = transferLand(game, 'prk', 'kor', 20_000);
  assert.ok(Object.keys(game.territory.overrides).length > 0);
  setOwner(game, moved.cells, 'prk');
  assert.deepEqual(game.territory.overrides, {}, 'restoring must return to the baseline');
});

test('an advance takes ground on the side facing the attacker', () => {
  const game = fresh();
  const anchor = frontAnchor(game, 'rus', 'chn');
  assert.ok(anchor, 'no front anchor between neighbours');
  const moved = transferLand(game, 'rus', 'chn', 400_000, anchor);
  assert.ok(moved.cells.length > 0);

  // Everything taken should sit closer to China than Russia's own centre does.
  const cells = landCells();
  const russianCentre = centroidOf(game, 'rus');
  const taken = moved.cells.map((slot) => cellCentre(cells[slot]));
  const meanLat = taken.reduce((s, c) => s + c.lat, 0) / taken.length;
  assert.ok(meanLat < russianCentre.lat, 'China should be taking Russia from the south');
});

test('a country is never stripped of its last patch of ground', () => {
  const game = fresh();
  transferLand(game, 'sgp', 'mys', 1e9);
  assert.ok(cellsOf(game, 'sgp').length >= 1, 'the border code must not erase a country');
});

test('a carved-out region is a real chunk, far from the capital', () => {
  const game = fresh();
  const carved = carveOutlyingRegion(game, 'rus', 0.25);
  const all = cellsOf(game, 'rus');
  assert.ok(carved.length > 3, 'nothing was carved');
  assert.ok(carved.length < all.length, 'the whole country was carved off');

  const cells = landCells();
  const lons = carved.map((slot) => cellCentre(cells[slot]).lon);
  const spread = Math.max(...lons) - Math.min(...lons);
  assert.ok(spread < 180, 'a breakaway should be one region, not scattered');
});

test('a country too small to split gives nothing back', () => {
  const game = fresh();
  assert.deepEqual(carveOutlyingRegion(game, 'sgp'), []);
});

test('drawing data is bounded enough to put in the DOM', () => {
  const game = fresh();
  let runs = 0;
  for (const id of holders(game)) runs += runsFor(game, id).length;
  assert.ok(runs > 100 && runs < 4000, `${runs} run rectangles is out of range`);

  let points = 0;
  for (const id of holders(game)) {
    for (const ring of outlineFor(game, id)) points += ring.length;
  }
  assert.ok(points > 2000 && points < 60_000, `${points} outline points is out of range`);
});

test('every country traces into closed rings rather than a staircase', () => {
  const game = fresh();
  for (const id of ['kor', 'fra', 'jpn', 'usa', 'rus']) {
    const rings = outlineFor(game, id);
    assert.ok(rings.length > 0, `${id} has no outline`);
    for (const ring of rings) assert.ok(ring.length >= 3, `${id} has a degenerate ring`);
  }

  // Smoothing must not move a border so far that a country changes size.
  const rings = outlineFor(game, 'fra');
  const lons = rings.flat().map((p) => p[0]);
  const lats = rings.flat().map((p) => p[1]);
  assert.ok(Math.min(...lons) > -20 && Math.max(...lons) < 25, 'France is still in Europe');
  assert.ok(Math.min(...lats) > 35 && Math.max(...lats) < 56);
});

test('an outline never draws a stripe across the world at the date line', () => {
  const game = fresh();
  // Russia and the United States both straddle it.
  for (const id of ['rus', 'usa']) {
    for (const ring of outlineFor(game, id)) {
      for (let i = 1; i < ring.length; i++) {
        assert.ok(
          Math.abs(ring[i][0] - ring[i - 1][0]) < 180,
          `${id} has a segment that wraps the globe`,
        );
      }
    }
  }
});

test('the starting area is a fixed reference the live area can be judged against', () => {
  const game = fresh();
  assert.equal(Math.round(startingAreaOf(game, 'fra')), Math.round(areaOf(game, 'fra')));
  transferLand(game, 'fra', 'deu', 60_000);
  assert.ok(areaOf(game, 'fra') < startingAreaOf(game, 'fra'), 'the baseline must not move with play');
});

test('an empty territory object behaves like an untouched map', () => {
  const game = fresh();
  game.territory = createTerritory();
  assert.equal(cellsOf(game, 'jpn').length, cellsOf(fresh(), 'jpn').length);
});

// ── Conquest ────────────────────────────────────────────────────────────────

test('overwhelming force takes the whole country, not a slice of it', () => {
  // The United States against Cuba is not a contest, and the map should say so.
  const game = createGame({ playerNationId: 'usa', difficulty: 5, seed: 'conquest', totalTurns: 40 });
  declareWar(game, 'usa', 'cub', { rng: new Rng(3), reason: 'test' });

  for (let i = 0; i < 10 && game.wars[0].active; i++) advanceTurn(game, { orders: [] });

  assert.equal(game.wars[0].active, false, 'the war should have finished');
  assert.equal(game.nations.cub.sovereign, false, 'Cuba should have been absorbed');
  assert.equal(cellsOf(game, 'cub').length, 0, 'a conquered country holds no ground');
  assert.equal(game.nations.cub.annexedBy, 'usa');
  assert.ok(areaOf(game, 'usa') > startingAreaOf(game, 'usa'), 'the conqueror keeps the ground');
});

test('a conquered country stops being a player in the world', () => {
  const game = createGame({ playerNationId: 'usa', difficulty: 5, seed: 'conquest', totalTurns: 40 });
  declareWar(game, 'usa', 'cub', { rng: new Rng(3), reason: 'test' });
  for (let i = 0; i < 10 && game.wars[0].active; i++) advanceTurn(game, { orders: [] });

  assert.ok(!sovereignIds(game).includes('cub'));
  assert.ok(!rankedNations(game).some((r) => r.state.id === 'cub'), 'and drops out of the rankings');
  // …but it is still on the books, so the run can say what happened to it.
  assert.ok(game.nations.cub, 'the record of it must survive');
});

test('near-peers fight over ground without either ceasing to exist', () => {
  const game = createGame({ playerNationId: 'ind', difficulty: 5, seed: 'peer', totalTurns: 60 });
  const before = areaOf(game, 'pak');
  declareWar(game, 'ind', 'pak', { rng: new Rng(11), reason: 'test' });

  // Measured during the war, not after it: a war that ends in stalemate or in
  // catastrophe hands the occupied ground back, so the end state can legitimately
  // match the start. What must be true is that the front moved while it ran.
  let lowest = before;
  for (let i = 0; i < 20 && game.wars[0].active; i++) {
    advanceTurn(game, { orders: [] });
    lowest = Math.min(lowest, areaOf(game, 'pak'));
  }

  assert.equal(game.nations.ind.sovereign, true);
  assert.equal(game.nations.pak.sovereign, true, 'neither near-peer should be absorbed');
  assert.ok(lowest < before, 'the front should have moved at some point');
  assert.equal(game.wars[0].active, false, 'and the war should have reached an end');
});

test('annexing what you occupy makes it permanent', () => {
  const game = createGame({ playerNationId: 'rus', difficulty: 5, seed: 'annex', totalTurns: 40 });
  const war = declareWar(game, 'rus', 'ukr', { rng: new Rng(5), reason: 'test' });
  advanceTurn(game, { orders: [] });
  advanceTurn(game, { orders: [] });

  const occupied = war.occupied.filter(([, , holder]) => holder === 'rus');
  if (!occupied.length) return; // Nothing taken yet on this seed; nothing to assert.

  const slots = occupied.map(([slot]) => slot);
  const done = annexOccupied(game, war, 'rus');
  assert.ok(done && done.cells === occupied.length);
  assert.equal(war.occupied.filter(([, , h]) => h === 'rus').length, 0, 'it leaves the occupation list');

  // A peace can no longer hand it back, because it is no longer occupied.
  concludeWar(game, war, new Rng(7), 'exhaustion');
  for (const slot of slots) assert.equal(ownerAt(game, slot), 'rus');
});

test('a country pushed off the map by any route is reconciled', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'reconcile' });
  seizeAll(game, 'cub', 'usa');
  const changes = reconcileSovereignty(game, new Rng(2));
  assert.ok(changes.some((c) => c.id === 'cub'), 'losing every acre must be noticed');
  assert.equal(game.nations.cub.sovereign, false);
});
