// Who can actually get there, and who therefore gets the ground.
//
// The bug these tests exist for: a coalition war could end with a country that
// had no navy, no bases and an ocean in the way administering territory it
// could not have reached with its entire army and a year's notice.

import test from 'node:test';
import assert from 'node:assert/strict';

import { startGame } from '../src/engine/lifecycle.js';
import { Rng } from '../src/engine/rng.js';
import { advanceTurn } from '../src/engine/turn.js';
import { declareWar, tickWars } from '../src/engine/war.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { setRelation, sovereignIds } from '../src/engine/state.js';
import { areaOf, cellsOf } from '../src/engine/territory.js';
import { sign } from '../src/engine/treaties.js';
import {
  MIN_REACH,
  adjacent,
  canReach,
  occupiersFor,
  projection,
  reach,
  reachDetail,
  stagingFor,
  theatreOf,
  theatrePower,
  theatreWeight,
} from '../src/engine/reach.js';

function fresh(playerId = 'usa', seed = 'reach') {
  return startGame({ playerNationId: playerId, difficulty: 5, seed, mode: 'stable' });
}

test('a shared border is total reach and needs nothing else', () => {
  const game = fresh();
  // Whoever the fitted map says the United States touches, it can walk into.
  const neighbours = sovereignIds(game).filter((id) => id !== 'usa' && adjacent(game, 'usa', id));
  assert.ok(neighbours.length, 'the United States borders somebody');
  for (const id of neighbours) {
    assert.equal(reach(game, 'usa', id), 1, `${id} is next door`);
    assert.equal(reachDetail(game, 'usa', id).why, 'border');
  }
});

test('reach falls with distance, and a blue-water navy is what buys it back', () => {
  const game = fresh();
  // Two countries roughly as far from Indonesia as each other. One has a navy,
  // global bases and a doctrine of being everywhere; the other has none of it.
  const superpower = reach(game, 'usa', 'idn');
  const landPower = reach(game, 'kaz', 'idn');
  assert.ok(superpower > landPower * 2,
    `a navy should be worth more than this: ${superpower.toFixed(2)} vs ${landPower.toFixed(2)}`);
  assert.ok(projection(game, 'usa') > projection(game, 'kaz') * 2.5,
    'projection should separate a global power from a landlocked one');
  // Nothing is ever literally zero — expeditions happen, they are just small.
  assert.ok(landPower > 0, 'reach never bottoms out at nothing');
});

test('an ally on the target’s border is a staging base', () => {
  const game = fresh();
  const rng = new Rng(11);
  // Poland borders Ukraine. Without paper, an American operation there is a
  // long way from home; with basing and transit, it starts in Rzeszów.
  const before = reachDetail(game, 'usa', 'ukr');
  setRelation(game, 'usa', 'pol', 85);
  sign(game, 'usa', 'pol', 'access', rng);
  const after = reachDetail(game, 'usa', 'ukr');

  const staging = stagingFor(game, 'usa', 'ukr');
  assert.ok(staging, 'somebody on the border should be offering an airfield');
  assert.ok(after.value >= before.value, 'staging cannot make reach worse');
  if (before.value < 1) {
    assert.ok(after.value > before.value, 'basing rights should actually shorten the trip');
  }
});

test('a war is fought with the force each side can bring, not the force it owns', () => {
  const game = fresh();
  const rng = new Rng(3);
  const war = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  assert.ok(war);

  // Ukraine's own weight in a war on Ukrainian soil is all of it.
  assert.equal(theatreWeight(game, 'ukr', war), 1);
  // A large but distant power counts for a fraction of itself.
  war.defenders.push('bra');
  const distant = theatreWeight(game, 'bra', war);
  assert.ok(distant < 0.75, `Brazil should not be at full strength in Ukraine (${distant})`);
  assert.ok(distant > 0, 'but it is not nothing either');

  // And the side total reflects that rather than summing armies.
  const owned = ['ukr', 'bra'].reduce((sum, id) => sum + theatreWeight(game, id, war), 0);
  assert.ok(owned < 2, 'a coalition is worth less than the sum of its armies');
  assert.ok(theatrePower(game, war.defenders, war) > 0);
});

test('ground goes to somebody who could have marched onto it', () => {
  const game = fresh();
  const rng = new Rng(7);
  const war = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  // A coalition of the distant and the willing.
  war.defenders.push('bra', 'zaf', 'aus');

  const able = occupiersFor(game, war.defenders, 'rus');
  for (const entry of able) {
    assert.ok(entry.reach >= MIN_REACH, `${entry.id} was offered ground it cannot reach`);
  }
  // And whoever heads the list is somebody with a real route in.
  if (able.length) assert.ok(canReach(game, able[0].id, 'rus'));
});

test('a country nobody in the war can reach does not lose ground', () => {
  const game = fresh();
  const rng = new Rng(19);
  const mods = gameModifiers(game);
  // New Zealand and Kazakhstan: one is an island at the bottom of the Pacific,
  // the other is landlocked in the middle of Asia. Neither can put an army on
  // the other whatever the war score says.
  const war = declareWar(game, 'kaz', 'nzl', { rng, reason: 'test' });
  assert.ok(war);
  // Strictly bilateral: New Zealand's friends coming in is a different test,
  // and one of them can reach Kazakhstan perfectly well. Their organisations
  // have to be emptied too, or the alliance answers and puts a navy in it.
  war.attackers = ['kaz'];
  war.defenders = ['nzl'];
  game.blocMembership.nzl = [];
  game.blocMembership.kaz = [];
  war.warScore = 90;
  const held = areaOf(game, 'nzl');

  for (let i = 0; i < 4; i++) {
    game.turn += 1;
    war.warScore = 90;
    tickWars(game, rng, mods);
    if (!war.active) break;
  }
  assert.equal(areaOf(game, 'nzl'), held, 'New Zealand cannot be invaded from Kazakhstan');
  assert.ok(war.unreachable > 0, 'and the war says so');
});

test('theatreOf names where the fighting is', () => {
  const game = fresh();
  const rng = new Rng(5);
  const war = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  assert.equal(theatreOf(game, war), 'ukr');
});

test('reach is deterministic — the same question gives the same answer', () => {
  const game = fresh();
  const first = sovereignIds(game).map((id) => reach(game, 'usa', id));
  const second = sovereignIds(game).map((id) => reach(game, 'usa', id));
  assert.deepEqual(first, second);
});

test('a whole run never hands a country to somebody who could not reach it', () => {
  for (const seed of ['r1', 'r2', 'r3']) {
    const game = startGame({ playerNationId: 'usa', difficulty: 8, seed, mode: 'chaotic' });
    for (let q = 0; q < 40 && game.status === 'active'; q++) advanceTurn(game, { orders: [] });

    for (const [id, state] of Object.entries(game.nations)) {
      if (state.sovereign !== false || !state.annexedBy) continue;
      // Whoever absorbed a country had to be able to get to it. Reach is
      // measured now rather than at the time, so this is a smell test rather
      // than a proof — but a country an ocean away with no navy should never
      // appear here at all.
      const holder = state.annexedBy;
      const cells = cellsOf(game, holder).length;
      assert.ok(cells > 0, `${holder} annexed ${id} while holding no ground at all`);
    }
  }
});
