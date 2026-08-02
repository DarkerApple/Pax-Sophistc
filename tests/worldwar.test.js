// Alliances that answer, wars that merge, and the point at which a war stops
// being somebody's and becomes everybody's.

import test from 'node:test';
import assert from 'node:assert/strict';

import { startGame } from '../src/engine/lifecycle.js';
import { Rng } from '../src/engine/rng.js';
import { advanceTurn } from '../src/engine/turn.js';
import { declareWar, tickWars } from '../src/engine/war.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { blocsOf, sovereignIds } from '../src/engine/state.js';
import { resolveAction } from '../src/engine/resolve.js';
import { ACTIONS_BY_ID } from '../src/engine/actions.js';
import {
  WORLD_WAR_SHARE,
  blocCall,
  brinkOfGeneralWar,
  generalityOf,
  mergeWars,
  tickWorldWar,
  worldWarReport,
} from '../src/engine/worldwar.js';

function fresh(playerId = 'pol', seed = 'ww') {
  return startGame({ playerNationId: playerId, difficulty: 5, seed, mode: 'stable' });
}

test('an attack on a bloc member is answered by the bloc', () => {
  const game = fresh();
  const rng = new Rng(4);
  // Poland is in NATO. Somebody who is not attacks it.
  assert.ok(blocsOf(game, 'pol').includes('nato'));
  const war = declareWar(game, 'rus', 'pol', { rng, reason: 'test' });
  war.attackers = ['rus'];
  war.defenders = ['pol'];
  war.blocAsked = {};

  const answers = blocCall(game, war, rng);
  const joined = answers.flatMap((a) => a.joined || []);
  assert.ok(joined.length >= 2, `an Article 5 call should bring several: got ${joined.length}`);
  for (const id of joined) {
    assert.ok(blocsOf(game, id).includes('nato') || blocsOf(game, id).includes('usAllied'),
      `${id} answered a call it is not party to`);
  }
  // And each organisation is asked once, not every quarter until it says yes.
  const askedOnce = { ...war.blocAsked };
  blocCall(game, war, rng);
  blocCall(game, war, rng);
  for (const tag of Object.keys(askedOnce)) {
    assert.equal(war.blocAsked[tag], askedOnce[tag], `${tag} was polled twice`);
  }
});

test('a bloc does not fight its own members', () => {
  const game = fresh();
  const rng = new Rng(9);
  // Two NATO members at war with each other: nobody's clause applies.
  const war = declareWar(game, 'tur', 'grc', { rng, reason: 'test' });
  war.attackers = ['tur'];
  war.defenders = ['grc'];
  war.blocAsked = {};
  const before = war.defenders.length;
  blocCall(game, war, rng);
  assert.equal(war.defenders.length, before, 'NATO cannot invoke NATO against NATO');
});

test('two wars with the same sides become one war', () => {
  const game = fresh();
  const rng = new Rng(2);
  const first = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  first.attackers = ['rus'];
  first.defenders = ['ukr'];
  // Built by hand rather than declared: declareWar refuses a second war between
  // countries already fighting, and this is a test of the merge and nothing else.
  const second = {
    id: 'war-test-2', name: 'The Second Front', active: true, startTurn: game.turn,
    attackers: ['blr', 'rus'], defenders: ['pol', 'ukr'],
    warScore: 10, exhaustion: { attackers: 20, defenders: 40 }, casualties: 5000, occupied: [],
  };
  game.wars.push(second);

  const reports = mergeWars(game);
  assert.equal(reports.length, 1, 'one merge');
  const kept = game.wars.find((w) => w.active);
  assert.ok(kept.attackers.includes('rus') && kept.attackers.includes('blr'));
  assert.ok(kept.defenders.includes('ukr') && kept.defenders.includes('pol'));
  assert.ok(kept.absorbedWars.length, 'the merged war remembers what it swallowed');
  // Nobody ends up on both sides.
  for (const id of kept.attackers) assert.ok(!kept.defenders.includes(id), `${id} is on both sides`);
});

test('unrelated wars are left alone', () => {
  const game = fresh();
  const rng = new Rng(6);
  const a = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  a.attackers = ['rus']; a.defenders = ['ukr'];
  const b = declareWar(game, 'eth', 'egy', { rng, reason: 'test' });
  b.attackers = ['eth']; b.defenders = ['egy'];
  assert.equal(mergeWars(game).length, 0);
  assert.equal(game.wars.filter((w) => w.active).length, 2);
});

test('a war goes general once enough of the world is in it on both sides', () => {
  const game = fresh();
  const rng = new Rng(8);
  const mods = gameModifiers(game);
  const war = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });

  // Not general yet, whatever the flags say.
  assert.equal(generalityOf(game, war).ready, false);

  // Now put the great powers in, on both sides.
  war.attackers = ['rus', 'chn', 'irn', 'prk', 'blr', 'pak', 'dza'];
  war.defenders = ['ukr', 'usa', 'deu', 'gbr', 'fra', 'pol', 'jpn', 'ind', 'kor', 'ita', 'esp', 'tur', 'can', 'aus'];
  const state = generalityOf(game, war);
  assert.ok(state.share >= WORLD_WAR_SHARE, `share was ${state.share}`);
  assert.ok(state.ready, 'that is a general war by any reading');

  const reports = tickWorldWar(game, war, rng, mods);
  assert.ok(war.worldWar, 'it is promoted');
  assert.ok(war.name !== war.formerName, 'and renamed');
  assert.ok(reports.some((r) => r.type === 'world-war'));
  assert.equal(worldWarReport(game).over, false);
});

test('a general war closes trade for people who are not even in it', () => {
  const game = fresh();
  const rng = new Rng(12);
  const mods = gameModifiers(game);
  const war = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  war.attackers = ['rus', 'chn', 'irn', 'prk', 'blr', 'pak', 'dza'];
  war.defenders = ['ukr', 'usa', 'deu', 'gbr', 'fra', 'pol', 'jpn', 'ind', 'kor', 'ita', 'esp', 'tur', 'can', 'aus'];

  assert.ok(!game.tradeShock);
  tickWorldWar(game, war, rng, mods);
  assert.ok(game.tradeShock > 0, 'sea lanes and payment systems close');
  // And the belligerents go onto a war footing exactly once.
  const mobilised = game.nations.chn.modifiers.filter((m) => m.source === 'worldwar');
  assert.equal(mobilised.length, 1);
  tickWorldWar(game, war, rng, mods);
  assert.equal(game.nations.chn.modifiers.filter((m) => m.source === 'worldwar').length, 1);
});

test('a coalition of everybody against one aggressor is not a world war', () => {
  const game = fresh();
  const rng = new Rng(15);
  const war = declareWar(game, 'prk', 'kor', { rng, reason: 'test' });
  // Half the world piles in on the defending side. It is still a police action:
  // there is only one great power doing any attacking.
  war.attackers = ['prk'];
  war.defenders = sovereignIds(game).filter((id) => id !== 'prk' && id !== 'usa' && id !== 'chn'
    && id !== 'fra' && id !== 'gbr' && id !== 'rus').slice(0, 25);
  const state = generalityOf(game, war);
  assert.equal(state.powers.attackers, 0);
  assert.equal(state.ready, false, 'both halves have to be able to fight');
});

test('the panel warns before it happens', () => {
  const game = fresh();
  const rng = new Rng(21);
  const war = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  war.attackers = ['rus', 'chn'];
  war.defenders = ['ukr', 'usa', 'deu', 'gbr', 'fra'];
  const brink = brinkOfGeneralWar(game);
  assert.ok(brink, 'a war this big should be flagged');
  assert.ok(brink.state.share > 0.13);
  assert.equal(brink.war.worldWar, undefined);
});

test('a player can walk into somebody else’s war on either side', () => {
  for (const [orderId, expected] of [['enter-alongside', 'defenders'], ['enter-against', 'attackers']]) {
    const game = fresh('gbr', `join-${orderId}`);
    const rng = new Rng(30);
    const mods = gameModifiers(game);
    const war = declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
    war.attackers = ['rus'];
    war.defenders = ['ukr'];

    const targetId = orderId === 'enter-alongside' ? 'ukr' : 'ukr';
    const outcome = resolveAction(game, rng, mods,
      { actionId: orderId, targetId }, 'gbr');
    assert.ok(outcome.joinedWar, `${orderId} did not put anybody in a war`);
    assert.equal(outcome.joinedWar.side, expected);
    assert.ok(war[expected].includes('gbr'));
  }
});

test('a declared armed neutrality is a position the engine respects', () => {
  const game = fresh('che');
  const rng = new Rng(33);
  const mods = gameModifiers(game);
  declareWar(game, 'rus', 'ukr', { rng, reason: 'test' });
  const outcome = resolveAction(game, rng, mods, { actionId: 'armed-neutrality-declared' }, 'che');
  assert.ok(outcome.tier !== 'failure' ? game.nations.che.neutralUntil > game.turn : true);
});

test('a whole run with the new machinery never throws or corrupts a war', () => {
  const game = startGame({ playerNationId: 'usa', difficulty: 9, seed: 'general', mode: 'chaotic' });
  for (let q = 0; q < 40 && game.status === 'active'; q++) advanceTurn(game, { orders: [] });
  for (const war of game.wars) {
    for (const id of war.attackers) {
      assert.ok(!war.defenders.includes(id), `${id} fought itself in ${war.name}`);
    }
    assert.ok(war.attackers.length && war.defenders.length, `${war.name} lost a side`);
  }
  // At most one war is ever the general one.
  assert.ok(game.wars.filter((w) => w.worldWar && w.active).length <= 1);
});
