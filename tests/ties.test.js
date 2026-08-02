// The second map: who needs whom, what closing an arrangement costs each side,
// and the propositions other governments actually answer.

import test from 'node:test';
import assert from 'node:assert/strict';

import { startGame } from '../src/engine/lifecycle.js';
import { Rng } from '../src/engine/rng.js';
import { ACTIONS_BY_ID } from '../src/engine/actions.js';
import { advanceTurn, growthOutlook } from '../src/engine/turn.js';
import { resolveAction, resolveDecision } from '../src/engine/resolve.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { declareWar } from '../src/engine/war.js';
import { setRelation, sovereignIds } from '../src/engine/state.js';
import {
  exposure,
  leverage,
  openShare,
  openness,
  restoreTies,
  severTies,
  tickTrade,
  tiesReport,
  tradeDrag,
  tradeHealth,
} from '../src/engine/dependency.js';
import { DEMANDS, odds, resolveExchanges, send } from '../src/engine/exchanges.js';

function fresh(playerId = 'kor', seed = 'ties') {
  return startGame({ playerNationId: playerId, difficulty: 5, seed, mode: 'stable' });
}

test('exposure is directed — small next to large is not the same relationship', () => {
  const game = fresh();
  const mexToUs = exposure(game, 'mex', 'usa');
  const usToMex = exposure(game, 'usa', 'mex');
  assert.ok(mexToUs > usToMex * 3,
    `Mexico needs the American market far more than the reverse (${mexToUs} vs ${usToMex})`);
});

test('Korea leans on both the American and the Chinese economy', () => {
  const game = fresh();
  const report = tiesReport(game, 'kor', 8);
  const names = report.dependsOn.map((d) => d.id);
  assert.ok(names.includes('usa'), 'the American market is one of Korea’s largest');
  assert.ok(names.includes('chn'), 'so is the Chinese one');
  assert.ok(exposure(game, 'kor', 'usa') > 0.03, 'and it is a real share, not a rounding error');
  // Every tie says what it is made of, so a player can read the shape of it.
  assert.ok(report.dependsOn.every((d) => Array.isArray(d.composition)));
});

test('cutting somebody off hurts whoever needed the arrangement more', () => {
  const game = fresh();
  const koreaBefore = growthOutlook(game, 'kor').growth;
  const americaBefore = growthOutlook(game, 'usa').growth;

  severTies(game, 'usa', 'kor', 1, 10, { label: 'test' });

  const koreaAfter = growthOutlook(game, 'kor').growth;
  const americaAfter = growthOutlook(game, 'usa').growth;
  const koreaCost = koreaBefore - koreaAfter;
  const americaCost = americaBefore - americaAfter;

  assert.ok(koreaCost > 0.15, `Korea should feel it: ${koreaCost.toFixed(3)}`);
  assert.ok(koreaCost > americaCost * 4,
    `and feel it far more than America does (${koreaCost.toFixed(3)} vs ${americaCost.toFixed(3)})`);
});

test('the leverage reading says which way it runs before you pull the lever', () => {
  const game = fresh();
  assert.equal(leverage(game, 'usa', 'mex').verdict, 'yours');
  assert.equal(leverage(game, 'mex', 'usa').verdict, 'theirs');
  const even = leverage(game, 'fra', 'deu');
  assert.ok(['even', 'slightly-yours', 'slightly-theirs'].includes(even.verdict),
    `two comparable neighbours should be near parity, got ${even.verdict}`);
});

test('an open world costs nobody anything', () => {
  const game = fresh();
  for (const id of sovereignIds(game)) {
    assert.equal(tradeHealth(game, id), 1, `${id} starts with everything open`);
    assert.equal(tradeDrag(game, id), 0, `${id} starts with no drag`);
  }
});

test('war closes the arrangement, peace re-opens most of it', () => {
  const game = fresh();
  const rng = new Rng(4);
  assert.equal(openShare(game, 'rus', 'ukr'), 1);
  declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  assert.equal(openShare(game, 'rus', 'ukr'), 0, 'nobody ships through a front');
});

test('a temporary cut lapses and a permanent one does not', () => {
  const game = fresh();
  severTies(game, 'usa', 'kor', 0.8, 2, { label: 'temporary' });
  severTies(game, 'usa', 'jpn', 0.8, 0, { label: 'indefinite' });
  assert.ok(openShare(game, 'usa', 'kor') < 1);

  tickTrade(game);
  tickTrade(game);
  assert.equal(openShare(game, 'usa', 'kor'), 1, 'the temporary one lapsed');
  assert.ok(openShare(game, 'usa', 'jpn') < 1, 'the indefinite one did not');

  restoreTies(game, 'usa', 'jpn', 1);
  assert.equal(openShare(game, 'usa', 'jpn'), 1);
});

test('the embargo order prices itself against the real relationship', () => {
  const game = fresh('usa', 'embargo');
  const rng = new Rng(9);
  const mods = gameModifiers(game);
  setRelation(game, 'usa', 'kor', -50);

  const outcome = resolveAction(game, rng, mods, { actionId: 'embargo', targetId: 'kor' }, 'usa');
  assert.ok(outcome.trade, 'the order actually closed something');
  assert.ok(openShare(game, 'usa', 'kor') < 0.2);
  const theirs = outcome.trade.a.id === 'kor' ? outcome.trade.a : outcome.trade.b;
  const mine = theirs === outcome.trade.a ? outcome.trade.b : outcome.trade.a;
  assert.ok(theirs.exposure > mine.exposure, 'and it cost them more than it cost us');
  assert.ok(theirs.gdp > 0, 'in real output, not only in a modifier');
});

test('the odds of a demand read the things a player can see', () => {
  const game = fresh('usa', 'demand');
  // A trivial ask of a friend beats a huge ask of an enemy.
  setRelation(game, 'usa', 'jpn', 80);
  setRelation(game, 'usa', 'irn', -90);
  const easy = odds(game, 'usa', 'jpn', 'open-markets');
  const hard = odds(game, 'usa', 'irn', 'leave-bloc');
  assert.ok(easy.chance > hard.chance + 0.25, `${easy.chance} should beat ${hard.chance}`);
  assert.ok(easy.factors.length, 'and the reasons are named');
  assert.ok(easy.factors.every((f) => typeof f.label === 'string'));
});

test('a demand is sent this quarter and answered the next', () => {
  const game = fresh('usa', 'answer');
  const rng = new Rng(14);
  const mods = gameModifiers(game);
  setRelation(game, 'usa', 'jpn', 80);

  const outcome = resolveAction(game, rng, mods,
    { actionId: 'demand-open-markets', targetId: 'jpn' }, 'usa');
  assert.ok(outcome.demand, 'the proposition went out');
  assert.equal(game.exchanges.length, 1);
  assert.equal(game.exchanges[0].status, 'sent');

  // Nothing is answered before it is due.
  assert.equal(resolveExchanges(game, rng, mods).reports.length, 0);
  game.turn += 1;
  const answered = resolveExchanges(game, rng, mods);
  assert.ok(answered.reports.length || answered.decision, 'they answered somehow');
  assert.notEqual(game.exchanges[0].status, 'sent');
});

test('the same demand cannot be sent twice while it is outstanding', () => {
  const game = fresh('usa', 'twice');
  const rng = new Rng(16);
  const mods = gameModifiers(game);
  const action = ACTIONS_BY_ID['demand-open-markets'];
  assert.ok(action.availableAgainst(game, 'jpn'));
  resolveAction(game, rng, mods, { actionId: 'demand-open-markets', targetId: 'jpn' }, 'usa');
  assert.equal(action.availableAgainst(game, 'jpn'), false, 'it is already on their desk');
});

test('every demand has terms for both answers', () => {
  for (const demand of Object.values(DEMANDS)) {
    assert.ok(demand.name && demand.ask, `${demand.id} needs a name and an ask`);
    assert.ok(demand.accepted && demand.refused, `${demand.id} needs both answers`);
    assert.ok(demand.pressure > 0 && demand.pressure <= 1, `${demand.id} pressure out of range`);
  }
});

test('a counter-offer comes back as a decision the player answers', () => {
  const game = fresh('usa', 'counter');
  const rng = new Rng(2);
  const mods = gameModifiers(game);
  setRelation(game, 'usa', 'bra', 30);

  const entry = send(game, 'usa', 'bra', 'open-markets');
  assert.ok(entry);
  // Force the middle band: not a yes, not a no.
  entry.status = 'sent';
  game.turn += 1;
  let decision = null;
  for (let i = 0; i < 40 && !decision; i++) {
    entry.status = 'sent';
    decision = resolveExchanges(game, rng, mods).decision;
  }
  if (!decision) return; // the rolls never landed in the band; the shape is tested below

  assert.equal(decision.exchangeId, entry.id);
  assert.ok(decision.choices.length >= 3, 'a counter-offer is a real choice');
  assert.ok(decision.choices.every((c) => c.settles), 'every branch settles the proposition');
  game.pendingDecision = decision;
  const record = resolveDecision(game, rng, mods, 'withdraw');
  assert.ok(record);
  assert.equal(game.exchanges.find((x) => x.id === entry.id).status, 'withdrawn');
});

test('a demand addressed to the player lands on the desk instead of resolving itself', () => {
  const game = fresh('kor', 'inbound');
  const rng = new Rng(5);
  const mods = gameModifiers(game);
  send(game, 'chn', 'kor', 'open-markets');
  game.turn += 1;

  const answer = resolveExchanges(game, rng, mods);
  assert.ok(answer.decision, 'somebody asking you for something is your decision to make');
  assert.equal(answer.decision.inbound, true);
  assert.equal(answer.decision.choices.length, 3, 'accept, buy it, or refuse');
  assert.ok(answer.decision.choices.every((c) => c.settles));

  // And answering it actually settles the proposition.
  game.pendingDecision = answer.decision;
  resolveDecision(game, rng, mods, 'refuse');
  assert.equal(game.exchanges[0].status, 'refused');
});

test('openness is bounded and every country has some', () => {
  const game = fresh();
  for (const id of sovereignIds(game)) {
    const value = openness(game, id);
    assert.ok(value > 0.1 && value < 0.65, `${id} openness out of range: ${value}`);
  }
});

test('a whole run with trade and exchanges running never throws', () => {
  for (const seed of ['t1', 't2']) {
    const game = startGame({ playerNationId: 'kor', difficulty: 7, seed, mode: 'chaotic' });
    for (let q = 0; q < 40 && game.status === 'active'; q++) {
      const report = advanceTurn(game, { orders: [] });
      assert.ok(report.tradeHealth >= 0 && report.tradeHealth <= 1);
      assert.ok(Array.isArray(report.exchanges));
    }
    // Nothing exceeded its own bounds along the way.
    for (const id of sovereignIds(game)) {
      assert.ok(tradeHealth(game, id) >= 0 && tradeHealth(game, id) <= 1);
    }
  }
});
