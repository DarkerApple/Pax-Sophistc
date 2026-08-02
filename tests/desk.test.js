// What actually reaches the desk: how many orders the office can carry, why the
// same one cannot be issued twice, the decisions that will not wait, and which
// country a new player should be.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS_BY_ID } from '../src/engine/actions.js';
import { NATIONS_BY_ID, playableNations } from '../src/data/nations.js';
import { Rng } from '../src/engine/rng.js';
import { startGame } from '../src/engine/lifecycle.js';
import { advanceTurn } from '../src/engine/turn.js';
import { EVENTS } from '../src/engine/events.js';
import { DECISIONS } from '../src/engine/decisions.js';
import { FACTION_IDS } from '../src/engine/factions.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { resolveDecision } from '../src/engine/resolve.js';
import { declareWar } from '../src/engine/war.js';
import {
  MAX_SLOTS,
  MIN_SLOTS,
  canQueue,
  leadership,
  nextSlotAt,
  orderSlots,
} from '../src/engine/leadership.js';
import {
  ARCHETYPES,
  createCountry,
  recommendedStarts,
  startDifficulty,
  validateCountry,
} from '../src/engine/starts.js';

const game = (id = 'kor', seed = 'desk') => startGame({ playerNationId: id, seed, totalTurns: 40 });

// ── Leadership buys slots ───────────────────────────────────────────────────

test('leadership is built from things a player can see and move', () => {
  const g = game();
  const lead = leadership(g);
  assert.ok(lead.value >= 0 && lead.value <= 100);
  assert.ok(lead.band.label, 'it has to read as a word, not only a number');
  assert.equal(lead.components.length, 5);
  for (const part of lead.components) {
    assert.ok(part.label, 'every component has to be nameable');
    assert.ok(part.value >= 0 && part.value <= 100);
  }
});

test('a commanding government can do more in a quarter than a spent one', () => {
  const strong = game('kor', 'strong');
  strong.nations.kor.approval = 92;
  strong.nations.kor.stability = 90;
  strong.nations.kor.unrest = 8;
  for (const id of FACTION_IDS) strong.factions[id].mood = 90;
  strong.turn = 30;

  const spent = game('kor', 'spent');
  spent.nations.kor.approval = 12;
  spent.nations.kor.stability = 20;
  spent.nations.kor.unrest = 85;
  for (const id of FACTION_IDS) spent.factions[id].mood = 10;

  assert.ok(
    orderSlots(strong) > orderSlots(spent),
    `authority has to buy something: ${orderSlots(strong)} vs ${orderSlots(spent)}`,
  );
  assert.ok(orderSlots(spent) >= MIN_SLOTS && orderSlots(strong) <= MAX_SLOTS);
  assert.ok(leadership(spent).value < leadership(strong).value);
});

test('unrest eats authority rather than merely failing to supply it', () => {
  const calm = game('kor', 'calm');
  calm.nations.kor.unrest = 20;
  const angry = game('kor', 'angry');
  angry.nations.kor.unrest = 90;
  assert.ok(leadership(angry).value < leadership(calm).value - 10);
  assert.ok(leadership(angry).drag > 0);
});

test('the panel can always say what the next slot would cost', () => {
  const g = game();
  g.nations.kor.approval = 40;
  g.nations.kor.stability = 40;
  const next = nextSlotAt(g);
  assert.ok(next, 'an ordinary government is not at the ceiling');
  assert.ok(next.gap > 0);
  assert.ok(next.lever.label, 'and it has to name the weakest leg');
});

test('the quarter honours the slot count rather than a constant four', () => {
  const g = game('kor', 'slots');
  g.nations.kor.approval = 95;
  g.nations.kor.stability = 92;
  g.nations.kor.unrest = 5;
  for (const id of FACTION_IDS) g.factions[id].mood = 92;
  g.turn = 30;
  g.politicalCapital = 20;
  g.nations.kor.treasury = 50_000;

  const slots = orderSlots(g);
  assert.ok(slots >= 5, `a commanding government should get more than four, got ${slots}`);

  const orders = ['address-nation', 'emergency-cabinet', 'exercises', 'messaging', 'rnd-push', 'multilateral']
    .slice(0, slots)
    .map((actionId) => ({ actionId }));
  const report = advanceTurn(g, { orders });
  assert.equal(report.playerOutcomes.length, orders.length, 'every order in the allowance must resolve');
});

// ── One order, once ─────────────────────────────────────────────────────────

test('the same order cannot be queued twice in one quarter', () => {
  const g = game();
  const order = ACTIONS_BY_ID.stimulus;
  const queued = [{ actionId: 'stimulus', targetId: null }];

  const again = canQueue(g, queued, order, null);
  assert.equal(again.ok, false);
  assert.match(again.reason, /twice|Already|이미/i, 'and it has to say why');

  assert.equal(canQueue(g, queued, ACTIONS_BY_ID.infrastructure, null).ok, true, 'a different order is fine');
});

test('but the same order against two different countries is a plan', () => {
  const g = game();
  const sanctions = ACTIONS_BY_ID.sanctions;
  const queued = [{ actionId: 'sanctions', targetId: 'prk' }];
  assert.equal(canQueue(g, queued, sanctions, 'chn').ok, true, 'sanctioning two countries is one policy');
  assert.equal(canQueue(g, queued, sanctions, 'prk').ok, false, 'sanctioning one country twice is not');
});

test('two orders that contradict each other cannot share a quarter', () => {
  const g = game('usa', 'clash');
  const join = ACTIONS_BY_ID['accede-asean'];
  const leave = ACTIONS_BY_ID['withdraw-nato'];
  const queued = [{ actionId: join.id, targetId: null, action: join }];
  assert.equal(canQueue(g, queued, leave, null).ok, false);
});

test('the desk fills up, and says so', () => {
  const g = game();
  const slots = orderSlots(g);
  const queued = Array.from({ length: slots }, (_, i) => ({ actionId: `filler-${i}`, targetId: null }));
  const blocked = canQueue(g, queued, ACTIONS_BY_ID.stimulus, null);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, new RegExp(String(slots)));
});

// ── The decisions ───────────────────────────────────────────────────────────

test('there are a lot of them and they are not all the same shape', () => {
  const decisions = EVENTS.filter((e) => e.kind === 'decision');
  assert.ok(decisions.length >= 20, `only ${decisions.length} decisions`);

  // A decision that offers two choices is a coin, not a decision.
  const g = game('usa', 'dshape');
  g.worldTension = 70;
  declareWar(g, 'prk', 'usa', { rng: new Rng(2), reason: 'claims' });
  let built = 0;
  for (const spec of DECISIONS) {
    const result = spec.build(g, new Rng(7));
    if (!result) continue;
    built += 1;
    assert.ok(result.prompt && result.prompt.length > 60, `${spec.id} has no real prompt`);
    assert.ok(result.choices.length >= 3, `${spec.id} offers only ${result.choices.length} ways out`);
    for (const choice of result.choices) {
      assert.ok(choice.label && choice.detail, `${spec.id}/${choice.id} is missing its words`);
      assert.ok(choice.effect, `${spec.id}/${choice.id} does nothing`);
    }
  }
  assert.ok(built >= 12, `only ${built} of them could build in a live world`);
});

test('most decisions name who at home wants each answer', () => {
  const g = game('usa', 'dfac');
  g.worldTension = 70;
  let withFactions = 0;
  let total = 0;
  for (const spec of DECISIONS) {
    const built = spec.build(g, new Rng(3));
    if (!built) continue;
    total += 1;
    if (built.choices.some((c) => c.factions)) withFactions += 1;
  }
  assert.ok(withFactions / total > 0.7, `only ${withFactions} of ${total} read by the factions`);
});

test('a decision moves the factions it said it would', () => {
  const g = game('usa', 'dmove');
  g.pendingDecision = {
    eventId: 'test', title: 'x', prompt: 'x', targetId: null,
    choices: [{ id: 'a', label: 'a', detail: 'a', effect: { self: {} }, factions: { staff: 6, street: -6 } }],
  };
  const staff = g.factions.staff.mood;
  const street = g.factions.street.mood;
  resolveDecision(g, new Rng(1), gameModifiers(g), 'a');
  assert.ok(g.factions.staff.mood > staff);
  assert.ok(g.factions.street.mood < street);
});

test('a decision that costs money actually costs it', () => {
  const g = game('usa', 'dcost');
  const before = g.nations.usa.treasury;
  g.pendingDecision = {
    eventId: 'test', title: 'x', prompt: 'x', targetId: null,
    choices: [{ id: 'a', label: 'a', detail: 'a', cost: { pctGdp: 2 }, effect: { self: {} } }],
  };
  resolveDecision(g, new Rng(1), gameModifiers(g), 'a');
  assert.ok(g.nations.usa.treasury < before, 'the money has to leave the treasury');
});

test('a wartime decision moves the war rather than only the statistics', () => {
  const g = game('kor', 'dwar');
  const war = declareWar(g, 'prk', 'kor', { rng: new Rng(4), reason: 'claims' });
  const score = war.warScore;
  g.pendingDecision = {
    eventId: 'test', title: 'x', prompt: 'x', targetId: null,
    choices: [{ id: 'a', label: 'a', detail: 'a', effect: { self: {} }, warEffect: { warScore: 20, casualties: 1000 } }],
  };
  resolveDecision(g, new Rng(1), gameModifiers(g), 'a');
  assert.notEqual(war.warScore, score, 'the front has to move');
  assert.ok(war.casualties > 0);
});

// ── Starting somewhere ──────────────────────────────────────────────────────

test('every country is rated for how hard it is, with reasons', () => {
  for (const nation of playableNations()) {
    const start = startDifficulty(nation);
    assert.ok(start.score >= 0 && start.score <= 100, `${nation.id} scored ${start.score}`);
    assert.ok(start.band.label);
    assert.ok(start.reasons.length > 0, `${nation.id} gives no reason`);
  }
});

test('the recommended starts are genuinely gentler than the United States', () => {
  const picks = recommendedStarts(6);
  assert.equal(picks.length, 6);
  const usa = startDifficulty(NATIONS_BY_ID.usa).score;
  for (const pick of picks) {
    assert.ok(pick.score <= usa, `${pick.nation.id} is not easier than the USA`);
  }
  // And they are ordered.
  for (let i = 1; i < picks.length; i++) {
    assert.ok(picks[i - 1].score <= picks[i].score, 'easiest first');
  }
});

test('a flashpoint is harder than a quiet neighbourhood', () => {
  assert.ok(
    startDifficulty(NATIONS_BY_ID.twn).score > startDifficulty(NATIONS_BY_ID.nzl).score,
    'Taiwan should not read as a gentler start than New Zealand',
  );
  assert.ok(
    startDifficulty(NATIONS_BY_ID.ukr).score > startDifficulty(NATIONS_BY_ID.che).score,
  );
});

// ── Inventing one ───────────────────────────────────────────────────────────

test('a country you invent is a country the engine cannot tell apart', () => {
  const def = createCountry({
    name: 'The Rennic Republic', capital: 'Renn', flag: '🏴',
    region: 'western-europe', archetype: 'trading-port',
  });
  assert.ok(def.id.startsWith('own-'));
  assert.equal(NATIONS_BY_ID[def.id], def, 'it has to be in the roster');
  assert.ok(def.capital && def.adjective && def.brief);
  assert.ok(Number.isFinite(def.lat) && Number.isFinite(def.lon));

  const g = startGame({ playerNationId: def.id, seed: 'invented', totalTurns: 12 });
  assert.ok(g.nations[def.id], 'and playable');
  const report = advanceTurn(g, { orders: [] });
  assert.equal(report.status, 'active');
  assert.ok(g.nations[def.id].gdp > 0);
});

test('two invented countries do not collide', () => {
  const a = createCountry({ name: 'Alba', region: 'eastern-europe', archetype: 'fortress-state' });
  const b = createCountry({ name: 'Alba', region: 'eastern-europe', archetype: 'fortress-state' });
  assert.notEqual(a.id, b.id);
  assert.ok(a.lat !== b.lat || a.lon !== b.lon, 'and they are not stacked on the same pixel');
});

test('every archetype is complete and produces a different country', () => {
  const seen = new Set();
  for (const archetype of ARCHETYPES) {
    assert.ok(archetype.name && archetype.blurb && archetype.difficulty);
    for (const key of ['gdp', 'population', 'military', 'stability', 'tech', 'unrest']) {
      assert.equal(typeof archetype.stats[key], 'number', `${archetype.id} has no ${key}`);
    }
    const shape = `${archetype.stats.gdp}:${archetype.stats.military}:${archetype.stats.stability}`;
    assert.ok(!seen.has(shape), `${archetype.id} is the same country as another one`);
    seen.add(shape);
  }
});

test('a country with no name is not a country', () => {
  assert.equal(validateCountry({ name: '', region: 'africa', archetype: 'trading-port' }).ok, false);
  assert.equal(validateCountry({ name: 'Ok', region: 'nowhere', archetype: 'trading-port' }).ok, false);
  assert.equal(validateCountry({ name: 'Ok', region: 'africa', archetype: 'nonsense' }).ok, false);
  assert.equal(validateCountry({ name: 'Ok', region: 'africa', archetype: 'trading-port' }).ok, true);
});
