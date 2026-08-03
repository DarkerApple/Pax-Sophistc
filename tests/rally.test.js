// Asking somebody who owes you nothing, and what decides whether they come.

import test from 'node:test';
import assert from 'node:assert/strict';

import { startGame } from '../src/engine/lifecycle.js';
import { Rng } from '../src/engine/rng.js';
import { ACTIONS_BY_ID } from '../src/engine/actions.js';
import { advanceTurn } from '../src/engine/turn.js';
import { resolveAction } from '../src/engine/resolve.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { declareWar } from '../src/engine/war.js';
import { adjustRelation, getRelation, setRelation } from '../src/engine/state.js';
import {
  COOLDOWN,
  askedRecently,
  canRally,
  rally,
  rallyAll,
  rallyCandidates,
  rallyOdds,
  ralliableWars,
} from '../src/engine/rally.js';

/** A bilateral war, so the coalition machinery does not colour the readings. */
function warBetween(game, rng, attacker, defender) {
  const war = declareWar(game, attacker, defender, { rng, reason: 'test' });
  war.attackers = [attacker];
  war.defenders = [defender];
  return war;
}

test('the countries most likely to come are the ones with a stake', () => {
  const game = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'rally', mode: 'stable' });
  const war = warBetween(game, new Rng(3), 'rus', 'ukr');

  const candidates = rallyCandidates(game, 'ukr', war, 8);
  assert.ok(candidates.length, 'somebody could be asked');
  // The frontline states with their own quarrel head the list; the far side of
  // the world does not appear on it at all.
  const top = candidates.slice(0, 4).map((c) => c.id);
  assert.ok(top.includes('pol'), `Poland should be near the top: ${top.join(', ')}`);
  assert.ok(rallyOdds(game, 'ukr', 'pol', war).chance
    > rallyOdds(game, 'ukr', 'nzl', war).chance * 5,
    'a bordering state with a grievance beats an island on the other side of the planet');

  // Every candidate carries its reasons, so a refusal can be understood.
  for (const entry of candidates) {
    assert.ok(Array.isArray(entry.factors));
    assert.ok(entry.chance >= 0 && entry.chance <= 1);
  }
});

test('starting the war makes it harder to find friends', () => {
  const rng = new Rng(4);
  const asDefender = startGame({ playerNationId: 'arg', difficulty: 5, seed: 'def', mode: 'stable' });
  const defWar = warBetween(asDefender, rng, 'bra', 'arg');
  const defending = rallyOdds(asDefender, 'arg', 'chl', defWar).chance;

  const asAggressor = startGame({ playerNationId: 'bra', difficulty: 5, seed: 'def', mode: 'stable' });
  const aggWar = warBetween(asAggressor, new Rng(4), 'bra', 'arg');
  const attacking = rallyOdds(asAggressor, 'bra', 'chl', aggWar).chance;

  assert.ok(defending > attacking,
    `defending should attract more help than attacking (${defending} vs ${attacking})`);
});

test('a country already in the war cannot be asked into it', () => {
  const game = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'in', mode: 'stable' });
  const war = warBetween(game, new Rng(6), 'rus', 'ukr');
  assert.equal(rallyOdds(game, 'ukr', 'rus', war).chance, 0);
  const ids = rallyCandidates(game, 'ukr', war, 20).map((c) => c.id);
  assert.ok(!ids.includes('rus') && !ids.includes('ukr'));
});

test('a country that says yes is a belligerent, and one that says no costs you', () => {
  const game = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'yes', mode: 'stable' });
  const rng = new Rng(7);
  const war = warBetween(game, rng, 'rus', 'ukr');

  setRelation(game, 'ukr', 'pol', 95);
  const before = getRelation(game, 'ukr', 'pol');
  const answer = rally(game, 'ukr', 'pol', war, rng);
  assert.ok(answer);
  if (answer.joined) {
    assert.ok(war.defenders.includes('pol'), 'they are in the war');
    assert.ok(getRelation(game, 'ukr', 'pol') > before, 'and warmer for it');
    assert.ok(getRelation(game, 'pol', 'rus') < 0, 'and colder with the enemy');
    assert.ok(game.nations.pol.modifiers.some((m) => m.source === 'rally'),
      'sending an army somewhere is not free');
  } else {
    assert.ok(getRelation(game, 'ukr', 'pol') < before, 'a refusal costs a little warmth');
  }
});

test('a refusal is remembered for a few quarters', () => {
  const game = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'cool', mode: 'stable' });
  const rng = new Rng(11);
  const war = warBetween(game, rng, 'rus', 'ukr');

  assert.equal(askedRecently(game, 'ukr', 'ita', war), false);
  rally(game, 'ukr', 'ita', war, rng);
  assert.equal(askedRecently(game, 'ukr', 'ita', war), true);
  assert.ok(!rallyCandidates(game, 'ukr', war, 30).some((c) => c.id === 'ita'),
    'and they are off the list while it lasts');

  game.turn += COOLDOWN;
  assert.equal(askedRecently(game, 'ukr', 'ita', war), false);
});

test('a general appeal is cheaper per capital and worse', () => {
  const game = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'sweep', mode: 'stable' });
  const rng = new Rng(2);
  const war = warBetween(game, rng, 'rus', 'ukr');

  const answer = rallyAll(game, 'ukr', war, rng);
  assert.ok(answer.joined.length + answer.refused.length > 1, 'it went to several capitals');
  assert.ok(answer.joined.length <= 3, 'and never brings the whole world at once');
  for (const entry of answer.joined) assert.ok(war.defenders.includes(entry.targetId));
});

test('both rally orders are on the shelf only while you are fighting', () => {
  const peace = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'peace', mode: 'stable' });
  for (const id of ['rally-one', 'rally-the-region']) {
    assert.equal(ACTIONS_BY_ID[id].available(peace), false, `${id} needs a war`);
  }
  const war = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'peace', mode: 'stable' });
  warBetween(war, new Rng(1), 'rus', 'ukr');
  for (const id of ['rally-one', 'rally-the-region']) {
    assert.equal(ACTIONS_BY_ID[id].available(war), true, `${id} should be offered in wartime`);
  }
  assert.ok(canRally(war, 'pol'), 'and a country not in it can be named');
  assert.equal(canRally(war, 'rus'), null, 'but the enemy cannot');
});

test('the order actually puts somebody in the war', () => {
  const game = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'order', mode: 'stable' });
  const rng = new Rng(9);
  const mods = gameModifiers(game);
  const war = warBetween(game, rng, 'rus', 'ukr');
  setRelation(game, 'ukr', 'pol', 95);

  let joined = false;
  for (let i = 0; i < 6 && !joined; i++) {
    game.turn += COOLDOWN;
    const outcome = resolveAction(game, rng, mods, { actionId: 'rally-one', targetId: 'pol' }, 'ukr');
    assert.ok(outcome.rally, 'the order made the call');
    joined = Boolean(outcome.rally.joined);
  }
  assert.ok(joined, 'a 90%-relation neighbour should say yes inside six tries');
  assert.ok(war.defenders.includes('pol'));
});

test('ralliableWars only lists wars you are actually in', () => {
  const game = startGame({ playerNationId: 'ukr', difficulty: 5, seed: 'lists', mode: 'stable' });
  const rng = new Rng(13);
  assert.equal(ralliableWars(game, 'ukr').length, 0);
  warBetween(game, rng, 'rus', 'ukr');
  assert.equal(ralliableWars(game, 'ukr').length, 1);
  assert.equal(ralliableWars(game, 'jpn').length, 0);
});

test('a whole run with the AI working the telephone never throws', () => {
  for (const seed of ['a1', 'a2']) {
    const game = startGame({ playerNationId: 'pol', difficulty: 8, seed, mode: 'chaotic' });
    for (let q = 0; q < 40 && game.status === 'active'; q++) advanceTurn(game, { orders: [] });
    for (const war of game.wars) {
      for (const id of war.attackers) assert.ok(!war.defenders.includes(id), `${id} on both sides`);
    }
  }
});
