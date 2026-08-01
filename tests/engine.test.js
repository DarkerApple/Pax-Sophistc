import test from 'node:test';
import assert from 'node:assert/strict';

import { NATIONS, NATIONS_BY_ID, RELATION_ANCHORS } from '../src/data/nations.js';
import { ACTIONS, ACTIONS_BY_ID, actionAvailability, actionCost } from '../src/engine/actions.js';
import { clampDifficulty, difficultyModifiers, difficultyPreview } from '../src/engine/difficulty.js';
import { applyEffect, scaleEffect } from '../src/engine/effects.js';
import { Rng, hashSeed } from '../src/engine/rng.js';
import { successChance } from '../src/engine/resolve.js';
import {
  createGame,
  deserialize,
  getRelation,
  serialize,
  setRelation,
} from '../src/engine/state.js';
import { advanceTurn, scoreRun, worldDigest } from '../src/engine/turn.js';
import { declareWar, findWar } from '../src/engine/war.js';

const mods = difficultyModifiers(5);

// ── Data integrity ─────────────────────────────────────────────────────────

test('nation roster is internally consistent', () => {
  const ids = new Set();
  for (const n of NATIONS) {
    assert.ok(!ids.has(n.id), `duplicate nation id: ${n.id}`);
    ids.add(n.id);
    assert.match(n.id, /^[a-z]{3}$/, `${n.id} should be a three-letter id`);
    assert.ok(n.gdp > 0, `${n.id} needs a positive GDP`);
    assert.ok(n.population > 0, `${n.id} needs a population`);
    assert.ok(n.lat >= -90 && n.lat <= 90, `${n.id} latitude out of range`);
    assert.ok(n.lon >= -180 && n.lon <= 180, `${n.id} longitude out of range`);
    for (const key of ['military', 'readiness', 'tech', 'stability', 'influence', 'unrest']) {
      assert.ok(n[key] >= 0 && n[key] <= 100, `${n.id}.${key} must be 0-100`);
    }
    assert.ok(n.brief && n.brief.length > 20, `${n.id} needs a brief`);
  }
  assert.ok(NATIONS.length >= 50, 'roster should cover a meaningful slice of the world');
});

test('relation anchors reference real nations', () => {
  for (const [a, b, value] of RELATION_ANCHORS) {
    assert.ok(NATIONS_BY_ID[a], `unknown nation in anchor: ${a}`);
    assert.ok(NATIONS_BY_ID[b], `unknown nation in anchor: ${b}`);
    assert.ok(value >= -100 && value <= 100);
  }
});

test('every action is well formed', () => {
  const ids = new Set();
  for (const action of ACTIONS) {
    assert.ok(!ids.has(action.id), `duplicate action id: ${action.id}`);
    ids.add(action.id);
    assert.ok(action.name && action.blurb, `${action.id} needs name and blurb`);
    assert.ok(action.pc >= 0 && action.pc <= 6, `${action.id} political capital out of range`);
    assert.ok(action.effects?.success, `${action.id} needs a success effect`);
    assert.ok(['none', 'nation'].includes(action.target), `${action.id} bad target type`);
    assert.ok(['low', 'medium', 'high'].includes(action.risk), `${action.id} bad risk`);
    assert.ok(action.baseSuccess > 0 && action.baseSuccess <= 1, `${action.id} bad baseSuccess`);
  }
});

// ── RNG ────────────────────────────────────────────────────────────────────

test('rng is deterministic and restorable', () => {
  const a = new Rng(hashSeed('pax'));
  const first = [a.next(), a.next(), a.next()];
  const b = new Rng(hashSeed('pax'));
  assert.deepEqual([b.next(), b.next(), b.next()], first);

  const mid = a.state;
  const tail = [a.next(), a.next()];
  assert.deepEqual([Rng.fromState(mid).next(), Rng.fromState(mid).next()][0], tail[0]);
});

test('rng stays within bounds', () => {
  const rng = new Rng(7);
  for (let i = 0; i < 500; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1);
    const n = rng.int(3, 9);
    assert.ok(n >= 3 && n <= 9);
  }
});

// ── Difficulty ─────────────────────────────────────────────────────────────

test('difficulty clamps and scales monotonically', () => {
  assert.equal(clampDifficulty(-4), 1);
  assert.equal(clampDifficulty(99), 10);
  assert.equal(clampDifficulty('7'), 7);
  assert.equal(clampDifficulty(undefined), 5);

  let prevPenalty = -1;
  let prevBudget = Infinity;
  for (let d = 1; d <= 10; d++) {
    const m = difficultyModifiers(d);
    assert.ok(m.successPenalty >= prevPenalty, 'harder must not be easier to succeed');
    assert.ok(m.budgetMultiplier <= prevBudget, 'harder must not pay better');
    prevPenalty = m.successPenalty;
    prevBudget = m.budgetMultiplier;
  }
  assert.equal(difficultyPreview(5).length, 6);
});

// ── Effects ────────────────────────────────────────────────────────────────

test('effects clamp stats to 0-100 and record changes', () => {
  const game = createGame({ playerNationId: 'fra', seed: 'fx' });
  game.nations.fra.stability = 98;

  const { changes } = applyEffect(game, 'fra', null, { self: { stability: 20, unrest: -500 } });
  assert.equal(game.nations.fra.stability, 100);
  assert.equal(game.nations.fra.unrest, 0);
  assert.ok(changes.some((c) => c.field === 'stability'));
});

test('scaleEffect scales numbers but keeps durations sane', () => {
  const scaled = scaleEffect(
    { self: { tech: 4 }, relation: 10, modifier: { label: 'x', turns: 6, growth: 0.2 } },
    1.5,
  );
  assert.equal(scaled.self.tech, 6);
  assert.equal(scaled.relation, 15);
  assert.equal(scaled.modifier.turns, 6);
});

test('world tension contributions can be damped for background actors', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'ts' });
  const before = game.worldTension;
  applyEffect(game, 'chn', null, { worldTension: 10 }, { tensionScale: 0.3 });
  assert.ok(Math.abs(game.worldTension - (before + 3)) < 0.001);
});

// ── State ──────────────────────────────────────────────────────────────────

test('new games start from the current-world baseline', () => {
  const game = createGame({ playerNationId: 'ind', difficulty: 6, seed: 'abc', totalTurns: 24 });
  assert.equal(game.playerId, 'ind');
  assert.equal(game.turn, 0);
  assert.equal(game.year, 2026);
  assert.equal(game.totalTurns, 24);
  assert.equal(Object.keys(game.nations).length, NATIONS.length);
  assert.ok(game.objectives.length >= 3);
  // Anchored relations survive construction.
  assert.equal(getRelation(game, 'ind', 'pak'), -74);
  assert.equal(getRelation(game, 'rus', 'ukr'), -96);
});

test('unknown nations are rejected', () => {
  assert.throws(() => createGame({ playerNationId: 'atlantis' }), /Unknown nation/);
});

test('relations are symmetric and clamped', () => {
  const game = createGame({ playerNationId: 'bra', seed: 'rel' });
  setRelation(game, 'bra', 'arg', 250);
  assert.equal(getRelation(game, 'bra', 'arg'), 100);
  assert.equal(getRelation(game, 'arg', 'bra'), 100);
  setRelation(game, 'bra', 'arg', -250);
  assert.equal(getRelation(game, 'arg', 'bra'), -100);
});

test('saves round-trip and reject the wrong version', () => {
  const game = createGame({ playerNationId: 'gbr', seed: 'save' });
  advanceTurn(game, { orders: [{ actionId: 'rnd-push' }] });
  const restored = deserialize(serialize(game));
  assert.equal(restored.turn, game.turn);
  assert.equal(restored.nations.gbr.gdp, game.nations.gbr.gdp);

  const bad = JSON.parse(serialize(game));
  bad.version = 999;
  assert.throws(() => deserialize(JSON.stringify(bad)), /not supported/);
});

// ── Actions ────────────────────────────────────────────────────────────────

test('action costs scale with the size of the economy', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'cost' });
  const stimulus = ACTIONS_BY_ID.stimulus;
  const usaCost = actionCost(stimulus, game.nations.usa);
  const cubaCost = actionCost(stimulus, game.nations.cub);
  assert.ok(usaCost > cubaCost * 100, 'a US stimulus should dwarf a Cuban one');
  assert.ok(cubaCost >= 0);
});

test('availability blocks unaffordable and untargeted orders', () => {
  const game = createGame({ playerNationId: 'cub', seed: 'avail' });
  game.nations.cub.treasury = 0;
  assert.equal(actionAvailability(game, ACTIONS_BY_ID.stimulus).ok, false);

  game.nations.cub.treasury = 1e6;
  assert.equal(actionAvailability(game, ACTIONS_BY_ID['state-visit']).ok, false, 'needs a target');
  assert.equal(actionAvailability(game, ACTIONS_BY_ID['state-visit'], 'usa').ok, true);
  assert.equal(actionAvailability(game, ACTIONS_BY_ID['state-visit'], 'cub').ok, false, 'cannot self-target');

  // Suing for peace requires an actual war.
  assert.equal(actionAvailability(game, ACTIONS_BY_ID['seek-peace'], 'usa').ok, false);
});

test('success chance responds to stats and difficulty', () => {
  const easy = createGame({ playerNationId: 'kor', difficulty: 1, seed: 'sc' });
  const hard = createGame({ playerNationId: 'kor', difficulty: 10, seed: 'sc' });
  const action = ACTIONS_BY_ID['rnd-push'];

  const easyChance = successChance(easy, action, 'kor', null, difficultyModifiers(1));
  const hardChance = successChance(hard, action, 'kor', null, difficultyModifiers(10));
  assert.ok(easyChance > hardChance, 'difficulty must bite');

  // A high-tech country should out-research a low-tech one.
  const game = createGame({ playerNationId: 'eth', seed: 'sc2' });
  const low = successChance(game, action, 'eth', null, mods);
  game.nations.eth.tech = 95;
  const high = successChance(game, action, 'eth', null, mods);
  assert.ok(high > low);
});

test('success chance never leaves the 3-97% band', () => {
  const game = createGame({ playerNationId: 'prk', difficulty: 10, seed: 'band' });
  for (const action of ACTIONS) {
    for (const stability of [0, 100]) {
      game.nations.prk.stability = stability;
      game.nations.prk.unrest = 100 - stability;
      const c = successChance(game, action, 'prk', 'usa', difficultyModifiers(10));
      assert.ok(c >= 0.03 && c <= 0.97, `${action.id} chance out of band: ${c}`);
    }
  }
});

// ── Turns ──────────────────────────────────────────────────────────────────

test('a turn advances the calendar and spends resources', () => {
  const game = createGame({ playerNationId: 'deu', seed: 'turn' });
  const treasuryBefore = game.nations.deu.treasury;
  const report = advanceTurn(game, { orders: [{ actionId: 'stimulus' }] });

  assert.equal(game.turn, 1);
  assert.equal(report.date, 'Q2 2026');
  assert.equal(report.playerOutcomes.length, 1);
  assert.ok(game.nations.deu.treasury !== treasuryBefore);
  assert.ok(game.log.length > 0);
});

test('the same seed and orders replay identically', () => {
  const orders = [{ actionId: 'rnd-push' }, { actionId: 'exercises' }];
  const run = () => {
    const game = createGame({ playerNationId: 'pol', difficulty: 7, seed: 'replay-me', totalTurns: 12 });
    for (let i = 0; i < 8; i++) advanceTurn(game, { orders });
    return game;
  };
  const a = run();
  const b = run();
  assert.equal(a.nations.pol.gdp, b.nations.pol.gdp);
  assert.equal(a.worldTension, b.worldTension);
  assert.deepEqual(a.log.map((l) => l.text), b.log.map((l) => l.text));
});

test('only four orders are accepted per quarter', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'cap' });
  const report = advanceTurn(game, {
    orders: Array.from({ length: 8 }, () => ({ actionId: 'exercises' })),
  });
  assert.equal(report.playerOutcomes.length, 4);
});

test('a finished game refuses further turns', () => {
  const game = createGame({ playerNationId: 'nzl', seed: 'end', totalTurns: 2 });
  advanceTurn(game, { orders: [] });
  advanceTurn(game, { orders: [] });
  assert.notEqual(game.status, 'active');
  assert.throws(() => advanceTurn(game, { orders: [] }), /already ended/);
});

test('stats stay inside their ranges across a long run', () => {
  const game = createGame({ playerNationId: 'irn', difficulty: 9, seed: 'longrun', totalTurns: 40 });
  while (game.status === 'active') {
    advanceTurn(game, {
      orders: [{ actionId: 'crackdown' }, { actionId: 'rearm' }],
      decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
    });
  }
  for (const state of Object.values(game.nations)) {
    for (const key of ['military', 'readiness', 'tech', 'stability', 'influence', 'unrest', 'approval']) {
      assert.ok(state[key] >= 0 && state[key] <= 100, `${state.id}.${key} = ${state[key]}`);
    }
    assert.ok(Number.isFinite(state.gdp) && state.gdp > 0, `${state.id} gdp went bad`);
    assert.ok(Number.isFinite(state.treasury));
  }
  assert.ok(game.worldTension >= 0 && game.worldTension <= 100);
});

test('higher difficulty produces measurably worse outcomes', () => {
  const play = (difficulty, seed) => {
    const game = createGame({ playerNationId: 'bra', difficulty, seed, totalTurns: 28 });
    while (game.status === 'active') {
      advanceTurn(game, {
        orders: [{ actionId: 'stimulus' }, { actionId: 'reform' }],
        decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
      });
    }
    return scoreRun(game);
  };

  // Averaged over several seeds, since any single run is noisy by design.
  const avg = (difficulty) => {
    const seeds = ['a', 'b', 'c', 'd', 'e'];
    return seeds.reduce((sum, s) => sum + play(difficulty, `${difficulty}-${s}`).components[0].value, 0) / seeds.length;
  };

  assert.ok(avg(2) > avg(9), 'the economy should fare better on an easier setting');
});

// ── War ────────────────────────────────────────────────────────────────────

test('war declaration wires up both sides and raises tension', () => {
  const game = createGame({ playerNationId: 'twn', seed: 'war' });
  const before = game.worldTension;
  const rng = new Rng(42);
  const war = declareWar(game, 'chn', 'twn', { rng });

  assert.ok(war);
  assert.ok(war.attackers.includes('chn'));
  assert.ok(war.defenders.includes('twn'));
  assert.ok(game.worldTension > before);
  assert.ok(getRelation(game, 'chn', 'twn') <= -90);
  assert.ok(findWar(game, 'twn', 'chn'));

  // No duplicate wars between the same pair.
  assert.equal(declareWar(game, 'chn', 'twn', { rng }), null);
});

test('wars end and are recorded', () => {
  const game = createGame({ playerNationId: 'ukr', difficulty: 6, seed: 'warend', totalTurns: 60 });
  declareWar(game, 'rus', 'ukr', { rng: new Rng(1) });

  let guard = 0;
  while (game.wars.some((w) => w.active) && guard++ < 60 && game.status === 'active') {
    advanceTurn(game, { orders: [], decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null });
  }
  const war = game.wars[0];
  assert.equal(war.active, false, 'wars must terminate');
  assert.ok(war.outcome, 'a finished war needs an outcome');
});

test('suing for peace can end a war', () => {
  const game = createGame({ playerNationId: 'kor', difficulty: 3, seed: 'peace', totalTurns: 60 });
  declareWar(game, 'prk', 'kor', { rng: new Rng(3) });
  game.nations.kor.influence = 100;

  let ended = false;
  for (let i = 0; i < 25 && !ended && game.status === 'active'; i++) {
    advanceTurn(game, {
      orders: [{ actionId: 'seek-peace', targetId: 'prk' }],
      decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
    });
    ended = !game.wars.some((w) => w.active);
  }
  assert.ok(ended, 'a determined negotiator should reach a settlement within six years');
});

// ── Scoring ────────────────────────────────────────────────────────────────

test('scoring produces a bounded grade and evaluates objectives', () => {
  const game = createGame({ playerNationId: 'zaf', seed: 'score', totalTurns: 8 });
  while (game.status === 'active') advanceTurn(game, { orders: [{ actionId: 'reform' }] });

  const score = scoreRun(game);
  assert.ok(score.total >= 0 && score.total <= 100);
  assert.ok('SABCDF'.includes(score.grade));
  assert.equal(score.components.length, 5);
  assert.equal(score.objectives.length, game.objectives.length);
  for (const obj of score.objectives) assert.equal(typeof obj.met, 'boolean');
});

test('collapse is possible and is graded as such', () => {
  const game = createGame({ playerNationId: 'cub', difficulty: 10, seed: 'collapse', totalTurns: 40 });
  game.nations.cub.stability = 3;
  game.nations.cub.unrest = 96;
  const report = advanceTurn(game, { orders: [] });
  assert.equal(game.status, 'defeat');
  assert.equal(report.ending.kind, 'collapse');
});

// ── Digest for the narrator ────────────────────────────────────────────────

test('world digest is compact and JSON-serialisable', () => {
  const game = createGame({ playerNationId: 'egy', seed: 'digest' });
  advanceTurn(game, { orders: [{ actionId: 'aid-package', targetId: 'eth' }] });

  const digest = worldDigest(game, 8);
  assert.equal(digest.powers.length, 8);
  assert.equal(digest.player.id, 'egy');
  assert.ok(typeof digest.worldTension === 'number');
  const json = JSON.stringify(digest);
  assert.ok(json.length < 6000, 'digest must stay small enough for a free-tier context');
  assert.deepEqual(JSON.parse(json).player.id, 'egy');
});
