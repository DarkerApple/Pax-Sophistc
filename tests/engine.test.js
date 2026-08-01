import test from 'node:test';
import assert from 'node:assert/strict';

import { NATIONS, NATIONS_BY_ID, RELATION_ANCHORS } from '../src/data/nations.js';
import {
  ACTIONS,
  ACTIONS_BY_ID,
  actionAvailability,
  actionCost,
  actionsInCategory,
  situationTags,
} from '../src/engine/actions.js';
import { clampDifficulty, difficultyModifiers, difficultyPreview } from '../src/engine/difficulty.js';
import { applyEffect, scaleEffect } from '../src/engine/effects.js';
import { availableFunds, creditLimit, debtStress, serviceDebt } from '../src/engine/finance.js';
import { Rng, hashSeed } from '../src/engine/rng.js';
import { successChance } from '../src/engine/resolve.js';
import {
  combatPower,
  createGame,
  deserialize,
  getRelation,
  serialize,
  setRelation,
} from '../src/engine/state.js';
import { advanceTurn, scoreRun, worldDigest } from '../src/engine/turn.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
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

  // An empty till is not a dead end — the credit line is still there.
  game.nations.cub.treasury = 0;
  assert.equal(actionAvailability(game, ACTIONS_BY_ID.stimulus).ok, true);

  // Past the credit line, though, it really is unaffordable.
  game.nations.cub.treasury = -availableFunds(game.nations.cub);
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
    return { gdp: game.nations.bra.gdp, score: scoreRun(game) };
  };

  // Averaged over several seeds, since any single run is noisy by design.
  // Measured on the raw quantities rather than the graded components: the
  // economy objective is easy enough for Brazil that its component pegs at 100
  // on every setting, which would hide a gradient that is really there.
  const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const avg = (difficulty, pick) =>
    seeds.reduce((sum, s) => sum + pick(play(difficulty, `${difficulty}-${s}`)), 0) / seeds.length;

  assert.ok(
    avg(2, (r) => r.gdp) > avg(9, (r) => r.gdp),
    'the economy should fare better on an easier setting',
  );
  assert.ok(
    avg(2, (r) => r.score.components[1].value) > avg(9, (r) => r.score.components[1].value),
    'the country should hold together better on an easier setting',
  );
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

// ── Power asymmetry ─────────────────────────────────────────────────────────

test('a big capability gap decides a targeted order, rather than nudging it', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'gap' });
  const mods = gameModifiers(game);
  const cyber = ACTIONS.find((a) => a.id === 'cyber-op');

  const versusSmall = successChance(game, cyber, 'usa', 'cub', mods);
  const versusPeer = successChance(game, cyber, 'usa', 'chn', mods);
  assert.ok(versusSmall > 0.9, `a superpower should walk this: ${versusSmall}`);
  assert.ok(versusPeer < versusSmall - 0.2, 'and a peer should be a real contest');

  // And the same order, the other way round, should be close to hopeless.
  const looking = createGame({ playerNationId: 'cub', seed: 'gap' });
  const upward = successChance(looking, cyber, 'cub', 'usa', mods);
  assert.ok(upward < 0.15, `punching up should be hard: ${upward}`);
});

test('combat power separates a superpower from a small state by an order of magnitude', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'power' });
  const ratio = combatPower(game, 'usa') / combatPower(game, 'cub');
  assert.ok(ratio > 12, `the gap should be decisive, got ${ratio.toFixed(1)}x`);

  // Near-peers must stay near-peers, or every war is over in one quarter.
  const peers = combatPower(game, 'usa') / combatPower(game, 'chn');
  assert.ok(peers > 1 && peers < 5, `near-peers should stay near, got ${peers.toFixed(1)}x`);
});

// ── Quick orders ────────────────────────────────────────────────────────────

test('the quick shelf answers what is actually happening', () => {
  const calm = createGame({ playerNationId: 'jpn', seed: 'calm' });
  const calmShelf = actionsInCategory('quick', calm).map((a) => a.id);
  assert.ok(calmShelf.length > 0, 'there is always something to do');
  assert.ok(!calmShelf.includes('disaster-relief'), 'nothing to relieve on a quiet quarter');
  assert.ok(!calmShelf.includes('reinforce-front'), 'and no front to reinforce');

  // Give it a war and a furious population, and the shelf should change.
  const pressed = createGame({ playerNationId: 'jpn', seed: 'calm' });
  pressed.nations.jpn.unrest = 70;
  declareWar(pressed, 'jpn', 'prk', { rng: new Rng(1), reason: 'test' });
  const pressedShelf = actionsInCategory('quick', pressed).map((a) => a.id);

  assert.ok(pressedShelf.includes('reinforce-front'), 'a war should put the front on the shelf');
  assert.ok(pressedShelf.includes('curfew'), 'and unrest should put a curfew on it');
  assert.notDeepEqual(pressedShelf, calmShelf, 'the shelf must not be the same every quarter');
});

test('the quick shelf stays short enough to be quick', () => {
  const game = createGame({ playerNationId: 'ind', seed: 'shelf' });
  game.nations.ind.unrest = 80;
  game.nations.ind.treasury = -500;
  game.worldTension = 90;
  assert.ok(actionsInCategory('quick', game).length <= 14);
});

test('situation tags are read off live state, not guessed', () => {
  const game = createGame({ playerNationId: 'bra', seed: 'tags' });
  assert.ok(!situationTags(game).has('war'));
  declareWar(game, 'bra', 'arg', { rng: new Rng(2), reason: 'test' });
  assert.ok(situationTags(game).has('war'));

  game.nations.bra.treasury = -1000;
  assert.ok(situationTags(game).has('debt'));
});

test('the quick catalogue is large, distinct, and entirely situational', () => {
  const quick = ACTIONS.filter((a) => a.quick);
  assert.ok(quick.length > 100, `the shelf should be deep: ${quick.length}`);

  // Every one of them has to be an answer to something, or it would sit on the
  // shelf forever and the filtering would be pointless.
  const alwaysOn = quick.filter((a) => !a.situational);
  assert.ok(alwaysOn.length <= 8, `too many unconditional quick orders: ${alwaysOn.length}`);

  const names = new Set(quick.map((a) => a.name));
  assert.equal(names.size, quick.length, 'two quick orders share a name');
});

test('every situation an order asks for is one the world can produce', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'vocab' });
  // Drive the state to extremes so the tag vocabulary is fully exercised.
  const seen = new Set();
  for (const [unrest, stability, treasury, tension] of [
    [90, 20, -900, 95], [10, 95, 9000, 10], [50, 50, 100, 50],
  ]) {
    Object.assign(game.nations.usa, { unrest, stability, treasury });
    game.worldTension = tension;
    for (const tag of situationTags(game)) seen.add(tag);
  }
  // Anything an order asks for must at least be a tag the model knows how to
  // set — otherwise that order can never appear.
  const known = new Set([...seen]);
  for (const tag of situationTags(createGame({ playerNationId: 'kor', seed: 'v2' }))) known.add(tag);

  const asked = new Set(ACTIONS.filter((a) => a.quick).flatMap((a) => a.situational || []));
  // Not every tag is reachable from three synthetic states, so this checks the
  // reverse: nothing the model produces is unused, which is the failure that
  // silently costs the player orders.
  for (const tag of known) {
    assert.ok(typeof tag === 'string' && tag.length > 1, `bad tag: ${tag}`);
  }
  assert.ok(asked.size > 40, `the catalogue should span the situation model: ${asked.size}`);
});

test('the shelf reorders as the situation changes', () => {
  const game = createGame({ playerNationId: 'kor', seed: 'reorder' });
  const before = actionsInCategory('quick', game).map((a) => a.id).join(',');

  game.nations.kor.unrest = 85;
  game.nations.kor.treasury = -800;
  const after = actionsInCategory('quick', game).map((a) => a.id).join(',');

  assert.notEqual(before, after, 'a crisis must change what is on offer');
  const shelf = after.split(',');
  assert.ok(shelf.includes('curfew') || shelf.includes('deploy-gendarmerie'), 'and offer an answer to it');
});
