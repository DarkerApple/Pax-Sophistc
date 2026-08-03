// What a country has to fight with, where it is fighting, and what the ground
// does to it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { startGame } from '../src/engine/lifecycle.js';
import { Rng } from '../src/engine/rng.js';
import { advanceTurn } from '../src/engine/turn.js';
import { declareWar, tickWars } from '../src/engine/war.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { areaOf, startingAreaOf } from '../src/engine/territory.js';
import { resolveAction } from '../src/engine/resolve.js';
import { ACTIONS_BY_ID } from '../src/engine/actions.js';
import {
  ARMS,
  arsenalOf,
  arsenalReport,
  available,
  commitmentCost,
  consume,
  defaultMix,
  depletion,
  establishmentOf,
  produce,
  strengthOf,
} from '../src/engine/arsenal.js';
import {
  TERRAIN,
  balanceOf,
  commit,
  frontsOf,
  garrison,
  mixStrength,
  mountOffensive,
  offensiveOdds,
  suitability,
  terrainOf,
} from '../src/engine/fronts.js';
import { OFFENSIVES } from '../src/engine/offensives.js';

function fresh(playerId = 'rus', seed = 'arms') {
  return startGame({ playerNationId: playerId, difficulty: 5, seed, mode: 'stable' });
}

function bilateral(game, rng, a, b) {
  const war = declareWar(game, a, b, { rng, reason: 'test' });
  war.attackers = [a];
  war.defenders = [b];
  return war;
}

// ── The arsenal ─────────────────────────────────────────────────────────────

test('every country has a readable order of battle derived from its own sheet', () => {
  const game = fresh();
  for (const id of ['usa', 'chn', 'prk', 'tur', 'isr', 'nga']) {
    const report = arsenalReport(game, id);
    assert.equal(report.arms.length, ARMS.length);
    for (const arm of report.arms) {
      assert.ok(Number.isInteger(arm.n) && arm.n >= 0, `${id} ${arm.id} count is not a count`);
      assert.ok(arm.quality > 0 && arm.quality <= 100);
      assert.ok(arm.available <= arm.n, 'you cannot deploy more than you own');
    }
    assert.ok(report.total > 0, `${id} should be able to field something`);
  }
});

test('force structure follows what a country actually is', () => {
  const game = fresh();
  const has = (id, arm) => arsenalOf(game, id)[arm].n;
  // A drone exporter has drones; an artillery wall has artillery; a landlocked
  // country has no fleet whatever its military rating says.
  assert.ok(has('tur', 'drones') > has('tur', 'airpower'), 'Turkey leans on drones');
  assert.ok(has('prk', 'artillery') > has('prk', 'armour'), 'North Korea leans on guns');
  assert.equal(has('kaz', 'navy'), 0, 'a landlocked country has no navy');
  assert.ok(has('usa', 'navy') > has('chn', 'navy'), 'a blue-water navy is a blue-water navy');
});

test('fighting consumes materiel and industry only partly replaces it', () => {
  const game = fresh();
  const rng = new Rng(3);
  const before = arsenalOf(game, 'rus').artillery.n;
  const losses = consume(game, 'rus', { artillery: 40 }, 1.5, rng);
  assert.ok(losses.artillery > 0, 'a hard quarter costs guns');
  assert.equal(arsenalOf(game, 'rus').artillery.n, before - losses.artillery);
  assert.equal(arsenalOf(game, 'rus').artillery.lost, losses.artillery);

  const made = produce(game, 'rus', { footing: 1 });
  assert.ok((made.artillery || 0) < losses.artillery || losses.artillery <= 1,
    'peacetime industry does not replace a bad quarter in one quarter');
});

test('small commitments still wear down over time rather than rounding to nothing', () => {
  const game = fresh();
  const rng = new Rng(9);
  const before = arsenalOf(game, 'rus').infantry.n;
  // Six brigades losing nine per cent of themselves is 0.54 of a brigade. Over
  // twelve quarters that has to add up to something.
  for (let i = 0; i < 12; i++) consume(game, 'rus', { infantry: 6 }, 1, rng);
  assert.ok(arsenalOf(game, 'rus').infantry.n < before, 'attrition must accumulate');
});

test('the establishment is remembered, so a ground-down country reads as ground down', () => {
  const game = fresh();
  const est = { ...establishmentOf(game, 'rus') };
  consume(game, 'rus', { infantry: 40, armour: 40, artillery: 40 }, 2, new Rng(1));
  // Degrading the country's sheet must not quietly lower the yardstick.
  game.nations.rus.military = 20;
  game.nations.rus.tech = 30;
  assert.deepEqual(establishmentOf(game, 'rus'), est);
  assert.ok(depletion(game, 'rus') > 0, 'losses have to show');
});

test('committing costs money in proportion to what is being moved', () => {
  const game = fresh();
  const small = commitmentCost(game, 'rus', { infantry: 2 });
  const large = commitmentCost(game, 'rus', { infantry: 2, armour: 20, navy: 5 });
  assert.ok(large > small * 3, 'moving an army is not the same as moving a battalion');
});

// ── Fronts ──────────────────────────────────────────────────────────────────

test('a war is drawn as several named sectors with their own ground', () => {
  const game = fresh();
  const rng = new Rng(4);
  const war = bilateral(game, rng, 'rus', 'ukr');
  const fronts = frontsOf(game, war);
  assert.ok(fronts.length >= 2, 'a war needs somewhere to choose between');
  const names = new Set(fronts.map((f) => f.name));
  assert.equal(names.size, fronts.length, 'two sectors cannot share a name');
  for (const front of fronts) {
    assert.ok(TERRAIN[front.terrainId], `${front.id} has no terrain`);
    assert.ok(front.width > 0 && front.width <= 1);
  }
  // Every war has an air campaign; a war with a coast has a maritime flank.
  assert.ok(fronts.some((f) => f.terrainId === 'air'));
  assert.ok(fronts.some((f) => f.terrainId === 'sea'));
  assert.equal(Number(fronts.reduce((s, f) => s + f.width, 0).toFixed(2)), 1);
});

test('the ground decides what an arm is worth on it', () => {
  const game = fresh();
  const rng = new Rng(6);
  const war = bilateral(game, rng, 'rus', 'ukr');
  const fronts = frontsOf(game, war);
  const air = fronts.find((f) => f.terrainId === 'air');
  const sea = fronts.find((f) => f.terrainId === 'sea');
  const land = fronts.find((f) => !terrainOf(f).noGround);

  const armour = { armour: 20 };
  const planes = { airpower: 20 };
  assert.ok(mixStrength(game, 'rus', land, armour) > mixStrength(game, 'rus', air, armour) * 5,
    'tanks are not an air campaign');
  assert.ok(mixStrength(game, 'rus', air, planes) > mixStrength(game, 'rus', land, planes),
    'aircraft are worth more in the air campaign than on the ground');
  assert.ok(suitability(game, 'rus', sea, armour) < 0.3, 'armour at sea is thrown away');
  assert.ok(suitability(game, 'rus', air, planes) > 1.5, 'and aircraft in the air are not');
});

test('force committed to one front is not available on another', () => {
  const game = fresh();
  const rng = new Rng(8);
  const war = bilateral(game, rng, 'rus', 'ukr');
  const [first, second] = frontsOf(game, war);
  const pool = available(game, 'rus', 'infantry');

  const placed = commit(game, war, first, 'attackers', { infantry: pool });
  assert.equal(placed.infantry, pool, 'everything went to the first sector');
  const overflow = commit(game, war, second, 'attackers', { infantry: pool });
  assert.equal(overflow.infantry ?? 0, 0, 'and there is nothing left for the second');
});

test('an offensive is priced from the ground, the balance and the lift', () => {
  const game = fresh();
  const rng = new Rng(11);
  const war = bilateral(game, rng, 'rus', 'ukr');
  garrison(game, war, 'defenders');
  const fronts = frontsOf(game, war);
  const land = fronts.find((f) => !terrainOf(f).noGround);
  const air = fronts.find((f) => f.terrainId === 'air');

  const breakMix = defaultMix(game, 'rus', 'break', 0.8);
  const strikeMix = defaultMix(game, 'rus', 'strike', 0.8);
  const onLand = offensiveOdds(game, war, land, 'attackers', breakMix);
  const inAir = offensiveOdds(game, war, air, 'attackers', breakMix);
  const airStrike = offensiveOdds(game, war, air, 'attackers', strikeMix);

  assert.ok(onLand.chance > inAir.chance, 'armour does not win an air campaign');
  assert.ok(airStrike.chance > inAir.chance, 'the right mix in the air does much better');
  assert.ok(onLand.factors.length, 'and every factor is named for the player');
  for (const f of onLand.factors) assert.ok(typeof f.label === 'string');
});

test('an offensive commits what it sends and spends what it commits', () => {
  const game = fresh();
  const rng = new Rng(13);
  const war = bilateral(game, rng, 'rus', 'ukr');
  const land = frontsOf(game, war).find((f) => !terrainOf(f).noGround);
  const before = arsenalOf(game, 'rus').armour.n;

  const result = mountOffensive(game, war, land.id, 'attackers', { armour: 12, infantry: 10 }, rng);
  assert.ok(result, 'the offensive happened');
  assert.ok(['breakthrough', 'gains', 'grinding', 'repulsed'].includes(result.tier));
  assert.ok(Object.keys(result.committed).length, 'force went in');
  assert.ok(arsenalOf(game, 'rus').armour.n < before, 'and some of it did not come back');
  assert.ok(result.casualties > 0);
});

test('every offensive order is a real operation with a mix and a home', () => {
  for (const op of OFFENSIVES) {
    assert.ok(op.offensive, `${op.id} is not an offensive`);
    assert.ok(op.offensive.share > 0 && op.offensive.share <= 1, `${op.id} share out of range`);
    assert.ok(['break', 'hold', 'attrit', 'strike', 'reach'].includes(op.offensive.intent),
      `${op.id} has no intent`);
    assert.equal(op.category, 'war');
    if (op.prefers) {
      for (const terrain of op.prefers) assert.ok(TERRAIN[terrain], `${op.id} wants ${terrain}`);
    }
  }
});

test('offensive orders are only on the shelf while there is a war', () => {
  const peace = fresh('rus', 'peace');
  assert.equal(ACTIONS_BY_ID['armoured-thrust'].available(peace), false);
  const war = fresh('rus', 'peace');
  bilateral(war, new Rng(1), 'rus', 'ukr');
  assert.equal(ACTIONS_BY_ID['armoured-thrust'].available(war), true);
});

// ── Land: worth taking, hard to lose ────────────────────────────────────────

test('a near-peer can be beaten badly and still not be erased', () => {
  const game = startGame({ playerNationId: 'ind', difficulty: 5, seed: 'floor', mode: 'stable' });
  const rng = new Rng(11);
  const war = bilateral(game, rng, 'ind', 'pak');
  const mods = gameModifiers(game);
  const started = startingAreaOf(game, 'pak');

  for (let i = 0; i < 30 && war.active; i++) {
    game.turn += 1;
    war.warScore = 95;
    for (const front of frontsOf(game, war)) front.line = 95;
    tickWars(game, rng, mods);
  }
  assert.notEqual(game.nations.pak.sovereign, false, 'a near-peer cannot erase a near-peer');
  assert.ok(areaOf(game, 'pak') >= started * 0.09,
    `the last tenth of a homeland has to hold: ${areaOf(game, 'pak')} of ${started}`);
});

test('a broken front takes far more ground than a grinding one', () => {
  const mods = gameModifiers(fresh());
  const measure = (line) => {
    const game = startGame({ playerNationId: 'usa', difficulty: 5, seed: 'bite', mode: 'stable' });
    const rng = new Rng(7);
    const war = bilateral(game, rng, 'usa', 'cub');
    const before = areaOf(game, 'cub');
    game.turn += 1;
    war.warScore = 60;
    for (const front of frontsOf(game, war)) front.line = line;
    tickWars(game, rng, mods);
    return before - areaOf(game, 'cub');
  };
  const grinding = measure(14);
  const broken = measure(95);
  assert.ok(broken > grinding * 1.5,
    `breaking a sector open should pay: ${broken.toFixed(0)} vs ${grinding.toFixed(0)}`);
});

test('a whole run with fronts and arsenals never throws or corrupts a stock', () => {
  for (const seed of ['w1', 'w2']) {
    const game = startGame({ playerNationId: 'ukr', difficulty: 8, seed, mode: 'chaotic' });
    for (let q = 0; q < 40 && game.status === 'active'; q++) advanceTurn(game, { orders: [] });
    for (const id of Object.keys(game.nations)) {
      const arsenal = game.nations[id].arsenal;
      if (!arsenal) continue;
      for (const [armId, stock] of Object.entries(arsenal)) {
        assert.ok(stock.n >= 0, `${id} ${armId} went negative`);
        assert.ok(stock.quality > 0 && stock.quality <= 100);
      }
    }
  }
});
