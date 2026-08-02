// The last act: the congress, the private ambitions, and the page a textbook
// writes from the run's own log.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/engine/rng.js';
import { startGame } from '../src/engine/lifecycle.js';
import { advanceTurn, scoreRun } from '../src/engine/turn.js';
import { adjustRelation, setRelation, sovereignIds } from '../src/engine/state.js';
import { secede, annexNation } from '../src/engine/statecraft.js';
import { transferLand } from '../src/engine/territory.js';
import {
  CLAUSE_TYPES,
  CONGRESS_LEAD,
  congressDue,
  congressOutcome,
  convene,
  lobby,
  propose,
  resolveCongress,
  tally,
  voteWeight,
} from '../src/engine/congress.js';
import { achieved, ambitionOf, revealAmbitions } from '../src/engine/ambitions.js';
import { chronicle, chronicleText } from '../src/engine/chronicle.js';

const game = (id = 'usa', seed = 'end') => startGame({ playerNationId: id, seed, totalTurns: 12 });

// ── The congress ────────────────────────────────────────────────────────────

test('the congress convenes in the closing year, not before', () => {
  const g = game();
  assert.equal(congressDue(g), false, 'not in the first quarter');
  g.turn = g.totalTurns - CONGRESS_LEAD;
  assert.equal(congressDue(g), true);
});

test('the order paper has clauses, and each one is a real vote', () => {
  const g = game();
  g.turn = g.totalTurns - CONGRESS_LEAD;
  const congress = convene(g, new Rng(1));
  assert.ok(congress.clauses.length >= 2);

  for (const clause of congress.clauses) {
    const result = tally(g, clause);
    assert.equal(result.votes.length, sovereignIds(g).length, 'everybody in the room votes');
    assert.ok(result.forWeight >= 0 && result.againstWeight >= 0);
    assert.ok(result.share >= 0 && result.share <= 1);
  }
});

test('voting weight is built from power, standing and blocs', () => {
  const g = game();
  assert.ok(voteWeight(g, 'usa') > voteWeight(g, 'cub'), 'a superpower is heard more than a small state');
  assert.ok(voteWeight(g, 'cub') > 0, 'but nobody is silent');
});

test('a clause the room does not want fails', () => {
  const g = game('cub', 'fail');
  g.turn = g.totalTurns - CONGRESS_LEAD;
  convene(g, new Rng(3));
  // Spheres of influence: written for the great powers, loathed by everyone else.
  const spheres = { id: 'x', typeId: 'spheres', title: 'x', detail: 'x', proposerId: null, lobby: {} };
  const result = tally(g, spheres);
  assert.equal(result.passing, false, 'fifty small states do not vote themselves into somebody’s sphere');
});

test('you get one proposal and three meetings, and both cost capital', () => {
  const g = game();
  g.turn = g.totalTurns - CONGRESS_LEAD;
  const congress = convene(g, new Rng(2));
  g.politicalCapital = 8;

  const unused = CLAUSE_TYPES.find((t) => !congress.clauses.some((c) => c.typeId === t.id));
  const first = propose(g, unused.id, new Rng(7));
  assert.equal(first.ok, true);
  assert.equal(g.politicalCapital, 5, 'a proposal costs three');
  assert.equal(propose(g, unused.id, new Rng(7)).ok, false, 'and there is only one');

  const target = sovereignIds(g).find((id) => id !== 'usa');
  const before = tally(g, first.clause).votes.find((v) => v.id === target).lean;
  const met = lobby(g, first.clause.id, target, scoreRun(g));
  assert.equal(met.ok, true);
  assert.equal(g.politicalCapital, 4);
  const after = tally(g, first.clause).votes.find((v) => v.id === target).lean;
  assert.ok(after > before, 'a meeting has to actually move somebody');

  lobby(g, first.clause.id, target, scoreRun(g));
  lobby(g, first.clause.id, target, scoreRun(g));
  assert.equal(lobby(g, first.clause.id, target, scoreRun(g)).ok, false, 'three meetings is three meetings');
});

test('the vote is held once, and what passes actually happens', () => {
  const g = game();
  g.turn = g.totalTurns - CONGRESS_LEAD;
  convene(g, new Rng(4));
  const tension = g.worldTension;

  const results = resolveCongress(g, new Rng(5));
  assert.ok(results.length >= 2);
  assert.equal(g.congress.resolved, true);
  assert.equal(resolveCongress(g, new Rng(6)), results, 'the floor does not reopen');

  const carried = results.filter((r) => r.passed);
  if (carried.length) {
    assert.ok(Object.keys(g.congressEffects || {}).length > 0, 'a carried clause has to change something');
  }
  const outcome = congressOutcome(g);
  assert.equal(outcome.total, results.length);
  assert.ok(outcome.verdict);
});

test('the settlement counts toward the grade', () => {
  const g = game();
  g.turn = g.totalTurns - CONGRESS_LEAD;
  convene(g, new Rng(9));
  const before = scoreRun(g).total;
  resolveCongress(g, new Rng(9));
  const after = scoreRun(g);
  assert.equal(typeof after.settlementBonus, 'number');
  assert.ok(after.settlement, 'and the ending has to be able to describe it');
});

// ── Ambitions ───────────────────────────────────────────────────────────────

test('every country is dealt a private ambition at setup', () => {
  const g = game();
  for (const id of sovereignIds(g).slice(0, 12)) {
    const ambition = ambitionOf(g, id);
    assert.ok(ambition, `${id} was dealt nothing`);
    assert.ok(ambition.title && ambition.detail);
  }
});

test('an ambition is checked against the world, not remembered as a flag', () => {
  const g = game();
  g.ambitions[g.playerId] = { id: 'never-fire', params: {}, dealtTurn: 0 };
  assert.equal(achieved(g, g.playerId), true, 'no wars yet');
  g.wars.push({ id: 'w', active: true, attackers: [g.playerId], defenders: ['cub'], warScore: 0, casualties: 0 });
  assert.equal(achieved(g, g.playerId), false, 'and one war ends it');
});

test('the reveal leads with you and with the rivalry', () => {
  const g = game();
  g.nemesis = { id: 'chn', since: 0, friction: 4, peak: 4, quarters: 4, origin: 'mutual', codename: 'x' };
  const reveal = revealAmbitions(g, { limit: 5 });
  assert.equal(reveal[0].id, g.playerId);
  assert.equal(reveal[1].id, 'chn');
  for (const entry of reveal) assert.equal(typeof entry.achieved, 'boolean');
});

// ── The closing page ────────────────────────────────────────────────────────

test('the page is written from the run, and names what actually happened', () => {
  const g = game('usa', 'page');
  for (let i = 0; i < 6; i++) advanceTurn(g, { orders: [] });

  const child = secede(g, 'rus', new Rng(7), { share: 0.3 });
  annexNation(g, 'cub', 'usa', new Rng(9));
  transferLand(g, 'mex', 'usa', 300);

  const page = chronicle(g, scoreRun(g));
  const text = chronicleText(page);

  assert.ok(page.title.includes('United States'));
  assert.ok(page.paragraphs.length >= 5, 'a page, not a sentence');
  assert.ok(text.includes(child.def.name), 'the state that declared itself has to be named');
  assert.ok(text.includes('Cuba'), 'and the one that stopped existing');
  assert.ok(page.epitaph, 'and it has to end on a line worth reading aloud');
  assert.equal(page.seed, g.seed, 'with the seed attached, so it can be replayed');
  assert.ok(page.ledger.length >= 8);
});

test('a quiet run and a violent one are not remembered the same way', () => {
  const quiet = game('nzl', 'quiet');
  for (let i = 0; i < 6; i++) advanceTurn(quiet, { orders: [] });
  const quietPage = chronicleText(chronicle(quiet, scoreRun(quiet)));

  const loud = game('usa', 'loud');
  for (let i = 0; i < 6; i++) advanceTurn(loud, { orders: [] });
  annexNation(loud, 'cub', 'usa', new Rng(2));
  annexNation(loud, 'ven', 'usa', new Rng(3));
  const loudPage = chronicleText(chronicle(loud, scoreRun(loud)));

  assert.notEqual(quietPage, loudPage);
  assert.ok(loudPage.includes('Cuba') && loudPage.includes('Venezuela'));
});
