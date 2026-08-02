// The domestic politics of governing: four creditors, one rivalry, a mandate
// that moves, a constitution that binds, and commitments that outlive the
// decision to make them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS_BY_ID, actionAvailability } from '../src/engine/actions.js';
import { Rng } from '../src/engine/rng.js';
import { advanceTurn, scoreContext, scoreRun } from '../src/engine/turn.js';
import { adjustRelation, getRelation, setRelation } from '../src/engine/state.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { resolveAction } from '../src/engine/resolve.js';
import { declareWar } from '../src/engine/war.js';
import {
  concludeTerm,
  electionState,
  ensureTerm,
  inheritance,
  rosterFromWorld,
  startGame,
} from '../src/engine/lifecycle.js';
import {
  FACTION_IDS,
  poles,
  politicalCapitalFrom,
  readingOf,
  recordOrder,
  snapshotStandings,
  tickFactions,
} from '../src/engine/factions.js';
import {
  frictionWith,
  nemesisOf,
  nemesisReport,
  noteQuarter,
  targetingBias,
  updateNemesis,
} from '../src/engine/nemesis.js';
import { estimate, intelOn, recordIntel } from '../src/engine/intel.js';
import { REVIEW_EVERY, liveObjectives, reviewDue, reviewMandate } from '../src/engine/mandate.js';
import {
  amend,
  amendmentsLeft,
  constitutionOf,
  electionOutlook,
  mayStandAgain,
  permits,
} from '../src/engine/constitution.js';
import { breakCost, cancel, commitmentsOf, committedSpend } from '../src/engine/commitments.js';

const game = (id = 'kor', seed = 'pol') => startGame({ playerNationId: id, seed, totalTurns: 40 });

// ── The four creditors ──────────────────────────────────────────────────────

test('every order is read by all four factions, from the order itself', () => {
  const rearm = readingOf(ACTIONS_BY_ID.rearm);
  const spend = readingOf(ACTIONS_BY_ID['social-spending']);

  assert.ok(rearm.staff > 0, 'rearmament has to please the general staff');
  assert.ok(spend.street > 0, 'social spending has to please the street');
  assert.ok(spend.staff < rearm.staff, 'and the two must not read the same way');
  assert.ok(readingOf(ACTIONS_BY_ID.austerity).street < 0, 'austerity is not popular');
  assert.ok(readingOf(ACTIONS_BY_ID['seek-peace']).staff < 0, 'the staff do not want the war ended');

  // Nothing is hand-authored per order, so a brand-new order still gets a
  // reading. This is the property that made three hundred orders cheap.
  const invented = readingOf({
    id: 'invented-for-this-test',
    category: 'military',
    cost: { pctGdp: 3 },
    effects: { success: { self: { military: 6, unrest: 4 } } },
  });
  assert.ok(invented.staff > 0 && invented.capital < 0);
});

test('an order names the faction that wanted it and the one that did not', () => {
  const { champion, objector } = poles(ACTIONS_BY_ID.crackdown);
  assert.ok(champion, 'somebody always wants a crackdown');
  assert.ok(objector, 'and somebody always does not');
  assert.notEqual(champion, objector);
});

test('political capital comes from the four, and a hostile faction subtracts', () => {
  const g = game();
  const mods = gameModifiers(g);
  for (const id of FACTION_IDS) g.factions[id].mood = 80;
  const backed = politicalCapitalFrom(g, mods);

  for (const id of FACTION_IDS) g.factions[id].mood = 10;
  const abandoned = politicalCapitalFrom(g, mods);

  assert.ok(backed.total > abandoned.total,
    `four supporters should outvote four opponents: ${backed.total} vs ${abandoned.total}`);
  assert.ok(abandoned.sources.some((s) => s.value < 0), 'a hostile faction spends against you');
  // Every point is attributable, which is what makes the number arguable.
  assert.equal(backed.sources.length, FACTION_IDS.length + 2);
});

test('a successful order moves the factions that care about it', () => {
  const g = game();
  const before = { ...g.factions };
  const moved = recordOrder(
    g,
    { actorId: g.playerId, actionId: 'rearm', tier: 'success' },
    ACTIONS_BY_ID.rearm,
  );
  assert.ok(moved.staff > 0, 'the staff should warm to rearmament');
  assert.ok(g.factions.staff.mood > 50);
});

test('an order that backfires disappoints the faction that wanted it', () => {
  const g = game();
  const start = g.factions.staff.mood;
  recordOrder(g, { actorId: g.playerId, actionId: 'rearm', tier: 'backfire' }, ACTIONS_BY_ID.rearm);
  assert.ok(g.factions.staff.mood < start, 'a botched rearmament is not a gift to the army');
});

test('factions ask for things, and missing the deadline costs more than meeting it', () => {
  const g = game();
  const rng = new Rng(5);
  // Force a demand on the party and let it run out.
  g.factions.party.demand = {
    id: 'stability', text: 'Hold stability above 60.', dueTurn: g.turn,
    snapshot: { readiness: 50, approval: 50, influence: 50, stability: 50 },
  };
  g.nations[g.playerId].stability = 20;
  const before = g.factions.party.mood;
  tickFactions(g, rng, gameModifiers(g), { playerOutcomes: [] });
  assert.ok(g.factions.party.mood < before - 5, 'a missed demand has to sting');

  const h = game('kor', 'pol2');
  h.factions.party.demand = {
    id: 'stability', text: 'Hold stability above 60.', dueTurn: h.turn,
    snapshot: { readiness: 50, approval: 50, influence: 50, stability: 50 },
  };
  h.nations[h.playerId].stability = 80;
  const was = h.factions.party.mood;
  tickFactions(h, new Rng(5), gameModifiers(h), { playerOutcomes: [] });
  assert.ok(h.factions.party.mood > was, 'and a met one has to be worth something');
});

test('standings read as words, not as bare numbers', () => {
  const g = game();
  for (const entry of snapshotStandings(g)) {
    assert.ok(entry.band.label, `${entry.id} has no plain-language standing`);
    assert.ok(entry.mood >= 0 && entry.mood <= 100);
  }
});

// ── The rivalry ─────────────────────────────────────────────────────────────

test('a country that keeps hitting you becomes the standing problem', () => {
  const g = game('usa', 'nem');
  assert.equal(nemesisOf(g), null, 'nobody is a nemesis on day one');

  // Ten quarters of one country doing things to you.
  for (let i = 0; i < 10; i++) {
    g.turn += 1;
    noteQuarter(g, {
      worldOutcomes: [{
        actorId: 'irn', targetId: 'usa', actionId: 'cyber-op',
        actionName: 'Cyber Operation', tier: 'success', text: 'x',
      }],
      playerOutcomes: [],
      wars: [],
    });
    adjustRelation(g, 'usa', 'irn', -12);
    g.escalation[['irn', 'usa'].sort().join('|')] = 6;
    updateNemesis(g, new Rng(i + 1));
  }

  const report = nemesisReport(g);
  assert.ok(report, 'ten quarters of hostility must produce a rivalry');
  assert.equal(report.id, 'irn');
  assert.ok(report.codename, 'and it must have a name the run can be remembered by');
  assert.ok(report.theirs.length >= 3, 'the file must remember the specific orders');
  assert.equal(report.origin, 'theirs', 'and which way round it started');
});

test('the rivalry makes them point their quarter at you', () => {
  const g = game('usa', 'nem2');
  assert.equal(targetingBias(g, 'irn', 'usa'), 1, 'no rivalry, no bias');
  g.nemesis = { id: 'irn', since: 0, friction: 4, peak: 4, quarters: 4, origin: 'theirs', codename: 'x' };
  assert.ok(targetingBias(g, 'irn', 'usa') > 1.8, 'a nemesis aims at you');
  assert.equal(targetingBias(g, 'irn', 'chn'), 1, 'and only at you');
  assert.equal(targetingBias(g, 'chn', 'usa'), 1, 'and only they do');
});

test('a rivalry that cools off lapses instead of running forever', () => {
  const g = game('usa', 'nem3');
  g.nemesis = { id: 'irn', since: 0, friction: 4, peak: 4, quarters: 8, origin: 'theirs', codename: 'x' };
  setRelation(g, 'usa', 'irn', 20);
  g.escalation = {};
  const result = updateNemesis(g, new Rng(2));
  assert.equal(result.kind, 'lapsed');
  assert.equal(nemesisOf(g), null);
  assert.ok(g.pastNemeses.irn, 'and it is kept for the closing page');
});

test('friction weighs what they can actually do about it', () => {
  const g = game('usa', 'nem4');
  for (const id of ['chn', 'cub']) {
    setRelation(g, 'usa', id, -80);
    g.escalation[['usa', id].sort().join('|')] = 7;
  }
  assert.ok(
    frictionWith(g, 'chn') > frictionWith(g, 'cub'),
    'being loathed by a great power is a rivalry; by a small one it is a nuisance',
  );
});

// ── The fog ─────────────────────────────────────────────────────────────────

test('foreign figures arrive as a band until intelligence narrows them', () => {
  const g = game('bra', 'fog');
  const before = estimate(g, 'prk', 'military');
  assert.equal(before.known, false, 'you do not simply know North Korea’s order of battle');
  assert.ok(before.high > before.low, 'an estimate is a range');
  assert.ok(before.text.includes('–'), `should read as a band, got ${before.text}`);

  g.intel = { prk: 0.9 };
  const after = estimate(g, 'prk', 'military');
  assert.equal(after.known, true);
  assert.equal(after.value, g.nations.prk.military);
});

test('your own figures are never fogged', () => {
  const g = game();
  const own = estimate(g, g.playerId, 'military');
  assert.equal(own.known, true);
  assert.equal(intelOn(g, g.playerId), 1);
});

test('an estimate does not move on its own between looks', () => {
  const g = game('bra', 'fog2');
  const a = estimate(g, 'chn', 'tech');
  const b = estimate(g, 'chn', 'tech');
  assert.deepEqual(a, b, 'a stable world must produce a stable estimate');
  // And two statistics are not wrong in the same direction.
  const mil = estimate(g, 'chn', 'military');
  assert.notEqual(a.estimate - g.nations.chn.tech, mil.estimate - g.nations.chn.military);
});

test('espionage buys a look, and the look goes stale', () => {
  const g = game('bra', 'fog3');
  const before = intelOn(g, 'chn');
  recordIntel(g, { actorId: g.playerId, targetId: 'chn', actionId: 'espionage', tier: 'success' });
  const after = intelOn(g, 'chn');
  assert.ok(after > before, 'a successful operation must tell you something');

  for (let i = 0; i < 20; i++) advanceTurn(g, { orders: [] });
  assert.ok(intelOn(g, 'chn') < after, 'and sources go cold');
});

// ── The mandate ─────────────────────────────────────────────────────────────

test('the mandate is rewritten by what actually happened', () => {
  const g = game('kor', 'mandate');
  const founding = liveObjectives(g).map((o) => o.id);
  assert.ok(founding.length >= 3);

  declareWar(g, 'prk', 'kor', { rng: new Rng(3), reason: 'test' });
  g.turn = REVIEW_EVERY;
  assert.equal(reviewDue(g), true);
  const review = reviewMandate(g, new Rng(4), scoreContext(g));

  assert.ok(review.added.length > 0, 'a war has to change what you are judged on');
  assert.ok(
    liveObjectives(g).some((o) => o.id === 'end-the-war'),
    'and specifically it has to demand the war be ended',
  );
  assert.ok(liveObjectives(g).some((o) => o.origin === 'history'));
});

test('an objective the world has made irrelevant is struck, not left to fail', () => {
  const g = game('kor', 'mandate2');
  declareWar(g, 'prk', 'kor', { rng: new Rng(3), reason: 'test' });
  g.turn = REVIEW_EVERY;
  reviewMandate(g, new Rng(4), scoreContext(g));
  assert.ok(liveObjectives(g).some((o) => o.id === 'end-the-war'));

  // The war ends; the demand about it should not still be on the desk.
  for (const war of g.wars) war.active = false;
  g.turn += REVIEW_EVERY;
  const second = reviewMandate(g, new Rng(5), scoreContext(g));
  assert.ok(second.retired.some((o) => o.id === 'end-the-war'));
  assert.ok(!liveObjectives(g).some((o) => o.id === 'end-the-war'));
});

test('the brief never grows without bound', () => {
  const g = game('kor', 'mandate3');
  for (let i = 0; i < 6; i++) {
    g.turn += REVIEW_EVERY;
    g.nations.kor.unrest = 80;
    g.nations.kor.treasury = -500;
    reviewMandate(g, new Rng(i), scoreContext(g));
  }
  assert.ok(liveObjectives(g).length <= 6, `a brief of ${liveObjectives(g).length} is not a brief`);
});

// ── The constitution ────────────────────────────────────────────────────────

test("a country's constitution follows from what kind of state it is", () => {
  const democracy = constitutionOf(game('deu', 'con1'));
  const oneParty = constitutionOf(game('chn', 'con2'));
  assert.notEqual(democracy.termLimit, 0, 'a parliamentary republic has term limits');
  assert.equal(oneParty.termLimit, 0, 'a one-party state does not');
  assert.equal(oneParty.emergencyPowers, 'permitted');
  assert.equal(democracy.emergencyPowers, 'restricted');
});

test('the constitution actually blocks orders rather than merely describing them', () => {
  const g = game('deu', 'con3');
  const order = ACTIONS_BY_ID['emergency-powers'];
  const check = permits(g, order);
  assert.equal(check.ok, false);
  assert.equal(check.clauseId, 'emergencyPowers');
  assert.equal(actionAvailability(g, order).ok, false, 'and it blocks at the point of ordering');

  constitutionOf(g).emergencyPowers = 'permitted';
  assert.equal(permits(g, order).ok, true);
});

test('one amendment per term, priced in political capital', () => {
  const g = game('deu', 'con4');
  g.politicalCapital = 12;
  assert.equal(amendmentsLeft(g), 1);

  const first = amend(g, 'emergencyPowers', 'permitted', new Rng(1));
  assert.equal(first.ok, true);
  assert.equal(constitutionOf(g).emergencyPowers, 'permitted');
  assert.equal(amendmentsLeft(g), 0);

  const second = amend(g, 'warPowers', 'executive', new Rng(1));
  assert.equal(second.ok, false, 'the second one has to wait for the next term');
});

test('removing your own term limit is read for exactly what it is', () => {
  const g = game('deu', 'con5');
  g.politicalCapital = 12;
  const before = g.nations.deu.unrest;
  amend(g, 'termLimit', 0, new Rng(1));
  assert.equal(constitutionOf(g).termLimit, 0);
  assert.ok(g.nations.deu.unrest > before, 'the country notices');
  assert.ok(g.log.some((e) => e.type === 'constitution'));
});

// ── Terms ───────────────────────────────────────────────────────────────────

test('a term ends in an election, and the country can say no', () => {
  const g = game('kor', 'term1');
  g.turn = g.totalTurns;
  g.nations.kor.approval = 12;
  g.nations.kor.unrest = 85;
  const score = scoreRun(g);
  const outlook = electionOutlook(g, score, g.factions);
  assert.ok(outlook.share < 50, 'an unpopular government should lose');
  assert.ok(outlook.reasons.length > 0, 'and be told why');

  const result = concludeTerm(g, score, { stand: true });
  assert.equal(result.outcome, 'defeated');
  assert.equal(g.term, 1, 'a lost election does not open a term');
  assert.equal(g.termHistory.length, 1, 'but it is on the record');
});

test('winning opens a second term on the same country, debts and all', () => {
  const g = game('kor', 'term2');
  g.politicalCapital = 12;
  resolveAction(g, new Rng(3), gameModifiers(g), { actionId: 'healthcare-programme' }, 'kor');
  const committedBefore = committedSpend(g);
  assert.ok(committedBefore > 0, 'the programme has to have committed the budget');

  g.turn = g.totalTurns;
  g.nations.kor.approval = 88;
  g.nations.kor.unrest = 12;
  g.nations.kor.stability = 80;
  for (const id of FACTION_IDS) g.factions[id].mood = 80;

  const result = concludeTerm(g, scoreRun(g), { stand: true });
  assert.equal(result.outcome, 're-elected');
  assert.equal(g.term, 2);
  assert.equal(g.status, 'active');
  assert.ok(g.totalTurns > g.turn, 'and there is a term to govern');
  assert.equal(committedSpend(g), committedBefore, 'the programme comes with you');
  assert.ok(liveObjectives(g).length >= 3, 'with a fresh brief');
});

test('a one-term constitution bars a second, and says which clause did it', () => {
  const g = game('kor', 'term3');
  constitutionOf(g).termLimit = 1;
  assert.equal(mayStandAgain(g), false);
  g.turn = g.totalTurns;
  const state = electionState(g, scoreRun(g));
  assert.equal(state.allowed, false);
  assert.equal(state.barredBy, 'termLimit');
  assert.equal(concludeTerm(g, scoreRun(g), { stand: true }).outcome, 'barred');
});

test('the world a run leaves behind can seed the next one', () => {
  const g = game('kor', 'seedworld');
  for (let i = 0; i < 4; i++) advanceTurn(g, { orders: [] });
  const roster = rosterFromWorld(g);
  assert.ok(roster.length > 40);
  const korea = roster.find((n) => n.id === 'kor');
  assert.equal(korea.gdp, Number(g.nations.kor.gdp.toFixed(3)));
  assert.ok(korea.inheritedFrom.seed === g.seed);
});

// ── Irreversibility ─────────────────────────────────────────────────────────

test('some programmes commit the budget for years', () => {
  const g = game('usa', 'commit');
  g.politicalCapital = 12;
  resolveAction(g, new Rng(1), gameModifiers(g), { actionId: 'blue-water-navy' }, 'usa');
  const running = commitmentsOf(g).filter((c) => !c.closed);
  assert.equal(running.length, 1);
  assert.ok(running[0].quarterly > 0);
  assert.ok(running[0].turnsLeft > 8);

  const before = g.nations.usa.treasury;
  advanceTurn(g, { orders: [] });
  assert.ok(commitmentsOf(g)[0].turnsLeft < running[0].turnsLeft + 1, 'it draws down every quarter');
});

test('cancelling early costs more than it saves this quarter', () => {
  const g = game('usa', 'commit2');
  g.politicalCapital = 12;
  resolveAction(g, new Rng(1), gameModifiers(g), { actionId: 'blue-water-navy' }, 'usa');
  const commitment = commitmentsOf(g)[0];
  const fee = breakCost(commitment);
  assert.ok(fee > commitment.quarterly, 'a break fee that is cheaper than one instalment is not a fee');

  const treasury = g.nations.usa.treasury;
  const result = cancel(g, commitment.id);
  assert.equal(result.ok, true);
  assert.equal(g.nations.usa.treasury, treasury - fee);
  assert.equal(committedSpend(g), 0);
});

test('the hand-off says exactly what the next term inherits', () => {
  const g = game('usa', 'inherit');
  g.politicalCapital = 12;
  resolveAction(g, new Rng(1), gameModifiers(g), { actionId: 'blue-water-navy' }, 'usa');
  const legacy = inheritance(g);
  assert.equal(legacy.commitments.length, 1);
  assert.ok(legacy.committedQuarterly > 0);
  assert.equal(typeof legacy.blocs, 'number');
});
