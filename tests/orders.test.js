// The order catalogue: how much of it is offered, and on what grounds.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONS,
  ACTIONS_BY_ID,
  CATEGORIES,
  actionAvailability,
  actionsInCategory,
  reasonFor,
  situationTags,
  targetedActionsFor,
} from '../src/engine/actions.js';
import { BLOCS } from '../src/data/nations.js';
import { Rng } from '../src/engine/rng.js';
import { blocsOf, createGame, setRelation } from '../src/engine/state.js';
import { resolveAction } from '../src/engine/resolve.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { declareWar } from '../src/engine/war.js';

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

function calm() {
  return createGame({ playerNationId: 'kor', seed: 'orders-calm', totalTurns: 40 });
}

/** A country in trouble on every front the tags can see. */
function crisis() {
  const game = createGame({ playerNationId: 'kor', seed: 'orders-crisis', totalTurns: 40 });
  const state = game.nations.kor;
  state.unrest = 82;
  state.approval = 24;
  state.stability = 31;
  state.treasury = -state.gdp * 1000 * 0.4;
  game.worldTension = 88;
  declareWar(game, 'prk', 'kor', { rng: new Rng(4), reason: 'test' });
  game.log.push({ turn: game.turn, type: 'territory', severity: 'major', date: 'Q1', text: 'x' });
  game.turnReports.push({ events: ['Riots in the capital', 'Epidemic spreads'] });
  return game;
}

test('every category offers a shelf, and none of them offers the whole catalogue', () => {
  const game = calm();
  for (const id of CATEGORY_IDS) {
    const whole = actionsInCategory(id);
    const offered = actionsInCategory(id, game);
    assert.ok(offered.length >= 1, `${id} offered nothing at all`);
    assert.ok(offered.length <= 14, `${id} offered ${offered.length} orders — that is a catalogue, not a shelf`);
    assert.ok(
      offered.length < whole.length,
      `${id} offered its entire catalogue (${whole.length}) — the situational filter did nothing`,
    );
    for (const action of offered) {
      assert.ok(whole.includes(action), `${id} offered ${action.id}, which is not in that category`);
    }
  }
});

test('the shelf changes with the world, in every category and not only Quick', () => {
  const quiet = calm();
  const bad = crisis();
  // War room only exists once there is a war, so it cannot be compared here.
  const comparable = CATEGORY_IDS.filter((id) => id !== 'war');

  const changed = comparable.filter((id) => {
    const before = actionsInCategory(id, quiet).map((a) => a.id).join();
    const after = actionsInCategory(id, bad).map((a) => a.id).join();
    return before !== after;
  });

  assert.deepEqual(
    changed.sort(),
    comparable.sort(),
    `these categories offered the same shelf in a crisis as in a calm quarter: ${
      comparable.filter((id) => !changed.includes(id)).join(', ')}`,
  );
});

test('a crisis puts the answer to the crisis on the shelf', () => {
  const game = crisis();
  const tags = situationTags(game);
  assert.ok(tags.has('boiling'), 'unrest at 82 should read as boiling');
  assert.ok(tags.has('debt'), 'a negative treasury should read as debt');

  const domestic = actionsInCategory('domestic', game);
  // Every situational order on the shelf must answer something happening now.
  for (const action of domestic) {
    if (!action.situational) continue;
    assert.ok(
      reasonFor(action, tags),
      `${action.id} is on the domestic shelf but answers nothing that is happening`,
    );
  }
  assert.ok(
    domestic.some((a) => (a.situational || []).includes('boiling') || (a.situational || []).includes('riot')),
    'a country at 82 unrest should be offered something about the streets',
  );
});

test('the shelf is deterministic — the same quarter offers the same orders', () => {
  const a = actionsInCategory('economy', crisis()).map((x) => x.id);
  const b = actionsInCategory('economy', crisis()).map((x) => x.id);
  assert.deepEqual(a, b);
});

test('one situation cannot flood a shelf on its own', () => {
  const game = crisis();
  const tags = situationTags(game);
  const counts = new Map();
  for (const action of actionsInCategory('quick', game)) {
    const reason = reasonFor(action, tags) || 'standing';
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  for (const [reason, n] of counts) {
    assert.ok(n <= 5, `${n} orders on the shelf all answer "${reason}"`);
  }
});

test('orders aimed at another country are ranked and capped too', () => {
  const game = crisis();
  // Solvent, because targetedActionsFor also drops anything you cannot pay for,
  // and a bankrupt country would test nothing but the overdraft.
  game.nations.kor.treasury = game.nations.kor.gdp * 1000 * 0.3;
  const offered = targetedActionsFor(game, 'jpn');
  const everything = ACTIONS.filter((a) => a.target === 'nation');
  assert.ok(offered.length > 0);
  assert.ok(offered.length <= 12, `${offered.length} targeted orders is a wall, not a menu`);
  assert.ok(offered.length < everything.length);
  for (const action of offered) {
    assert.ok(actionAvailability(game, action, 'jpn').ok, `${action.id} was offered but cannot be issued`);
  }
});

// ── Changing sides ──────────────────────────────────────────────────────────

test('every bloc, real and invented, has an accede and a withdraw order', () => {
  for (const bloc of Object.values(BLOCS)) {
    assert.ok(ACTIONS_BY_ID[`accede-${bloc.id}`], `no way to join ${bloc.id}`);
    assert.ok(ACTIONS_BY_ID[`withdraw-${bloc.id}`], `no way to leave ${bloc.id}`);
  }
  assert.ok(
    Object.values(BLOCS).some((b) => b.invented),
    'the world should contain organisations that do not exist in reality',
  );
});

test('invented blocs start with real members', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'blocs' });
  for (const bloc of Object.values(BLOCS).filter((b) => b.invented)) {
    const members = Object.keys(game.nations).filter((id) => blocsOf(game, id).includes(bloc.id));
    assert.ok(members.length >= 2, `${bloc.id} has nobody in it, so nobody can ever be invited`);
  }
});

test('joining a bloc does not cancel the ones you were already in', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'blocs' });
  const before = [...blocsOf(game, 'usa')];
  assert.ok(before.includes('nato'));

  // Warm enough for an invitation, from a bloc the USA is not in.
  for (const id of Object.keys(game.nations)) {
    if (blocsOf(game, id).includes('asean')) setRelation(game, 'usa', id, 70);
  }
  const join = ACTIONS_BY_ID['accede-asean'];
  assert.ok(join.available(game), 'friends inside should make the invitation possible');

  resolveAction(game, new Rng(11), gameModifiers(game), { actionId: join.id }, 'usa');
  const after = blocsOf(game, 'usa');
  for (const bloc of before) {
    assert.ok(after.includes(bloc), `joining ASEAN dropped ${bloc}`);
  }
});

test('you cannot accede to a bloc that has nobody willing to propose you', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'blocs' });
  for (const id of Object.keys(game.nations)) {
    if (blocsOf(game, id).includes('csto')) setRelation(game, 'usa', id, -80);
  }
  const join = ACTIONS_BY_ID['accede-csto'];
  assert.equal(join.available(game), false);
  assert.equal(actionAvailability(game, join).ok, false);
  assert.ok(!actionsInCategory('diplomacy', game).includes(join));
});

test('walking out of a bloc actually removes the membership', () => {
  const game = createGame({ playerNationId: 'usa', seed: 'blocs' });
  const leave = ACTIONS_BY_ID['withdraw-nato'];
  assert.ok(leave.available(game));

  // Forced through: the point is the structural change, not the dice.
  const rng = new Rng(3);
  rng.next = () => 0;
  resolveAction(game, rng, gameModifiers(game), { actionId: leave.id }, 'usa');

  assert.ok(!blocsOf(game, 'usa').includes('nato'));
  assert.equal(leave.available(game), false, 'you cannot leave twice');
  assert.ok(game.log.some((e) => e.type === 'alignment'), 'the withdrawal should be on the record');
});
