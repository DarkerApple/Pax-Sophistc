// Balance of power: the world noticing who has been taking things.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame, getRelation, sovereignIds } from '../src/engine/state.js';
import { advanceTurn } from '../src/engine/turn.js';
import { Rng } from '../src/engine/rng.js';
import { declareWar } from '../src/engine/war.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import {
  aggressionScore,
  balancingChance,
  opposingCoalition,
  primaryThreat,
  recordAggression,
  threatOf,
  threats,
} from '../src/engine/coalitions.js';

const fresh = (id = 'usa', seed = 'coal') => createGame({ playerNationId: id, seed, totalTurns: 60 });

test('a country that has done nothing is not a threat', () => {
  const game = fresh();
  // The largest economy on earth, at peace, is not something the world mobilises against.
  assert.ok(threatOf(game, 'usa') < 0.45, `an idle superpower should not alarm anyone: ${threatOf(game, 'usa')}`);
  assert.equal(threatOf(game, 'jpn'), 0);
  assert.deepEqual(threats(game, 0.5), []);
});

test('aggression is recorded, weighted and forgotten', () => {
  const game = fresh();
  recordAggression(game, 'rus', 'war', 1.4);
  const fresh1 = aggressionScore(game, 'rus');
  assert.ok(fresh1 > 1.3, 'a fresh act should count nearly in full');

  game.turn = 8;
  assert.ok(aggressionScore(game, 'rus') < fresh1, 'and should decay with time');

  game.turn = 40;
  assert.equal(aggressionScore(game, 'rus'), 0, 'and eventually be forgotten');
});

test('conquest makes a country a threat, and the threat is felt everywhere', () => {
  const game = fresh('usa', 'threat');
  const before = threatOf(game, 'usa');
  for (let i = 0; i < 3; i++) recordAggression(game, 'usa', 'annexation', 3.2);
  assert.ok(threatOf(game, 'usa') > before + 0.2, 'taking countries must register');
  assert.equal(primaryThreat(game).id, 'usa');
});

test('third parties join a war against an aggressor they owe nothing', () => {
  const game = fresh('usa', 'join');
  const mods = gameModifiers(game);
  // A quiet superpower attacking a neighbour: some treaty allies, few balancers.
  const quiet = opposingCoalition(game, new Rng(4), 'usa', 'mex', mods).length;

  // The same country after a run of annexations.
  for (let i = 0; i < 4; i++) recordAggression(game, 'usa', 'annexation', 3.2);
  const alarmed = opposingCoalition(game, new Rng(4), 'usa', 'mex', mods).length;

  assert.ok(alarmed > quiet, `a record of conquest must draw a bigger coalition: ${quiet} → ${alarmed}`);
});

test('nobody joins a war against a country they are close to', () => {
  const game = fresh('usa', 'friend');
  for (let i = 0; i < 4; i++) recordAggression(game, 'usa', 'annexation', 3.2);
  // The United Kingdom starts strongly aligned with the United States.
  assert.equal(balancingChance(game, 'gbr', 'usa', 'mex'), 0);
});

test('weak states can still balance — that is the point of a coalition', () => {
  const game = fresh('usa', 'weak');
  for (let i = 0; i < 4; i++) recordAggression(game, 'usa', 'annexation', 3.2);
  // Somebody small, nearby, and not fond of the aggressor.
  const chance = balancingChance(game, 'ven', 'usa', 'mex');
  assert.ok(chance > 0.02, `a small hostile neighbour should have some chance: ${chance}`);
  assert.ok(chance < 0.8, 'but never a certainty');
});

test('a rampage turns the world against you and a quiet run does not', () => {
  // Brazil, deliberately: it is in no defence pact, so the passive run stays
  // passive instead of being dragged into somebody else's war and finishing it
  // holding their territory — which is a real outcome, but not the one this
  // test is about.
  const play = (aggressive) => {
    const game = createGame({ playerNationId: 'bra', seed: 'ramp', totalTurns: 60 });
    const mods = gameModifiers(game);
    const victims = ['ury', 'arg', 'col'].filter((id) => game.nations[id]);
    let next = 0;
    // Measured at its peak, not at the end: an aggressor that gets destroyed for
    // what it did finishes the run at threat zero, which is the system working
    // rather than the system failing.
    let peakThreat = 0;
    // The true low point across the run. Starting this at zero would floor both
    // runs at zero whenever average relations never actually go negative, which
    // makes a real difference between them invisible.
    let coldest = Infinity;
    for (let q = 0; q < 12 && game.status === 'active'; q++) {
      if (aggressive) {
        const fighting = game.wars.some(
          (w) => w.active && (w.attackers.includes('bra') || w.defenders.includes('bra')),
        );
        if (!fighting && next < victims.length && game.nations[victims[next]].sovereign !== false) {
          declareWar(game, 'bra', victims[next], { rng: new Rng(50 + q), mods, reason: 'test' });
          next += 1;
        }
      }
      advanceTurn(game, {
        orders: [],
        decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
      });
      peakThreat = Math.max(peakThreat, threatOf(game, 'bra'));
      const live = sovereignIds(game).filter((id) => id !== 'bra');
      if (live.length) {
        coldest = Math.min(
          coldest,
          live.reduce((sum, id) => sum + getRelation(game, 'bra', id), 0) / live.length,
        );
      }
    }
    return { deeds: aggressionScore(game, 'bra'), threat: peakThreat, warmth: coldest };
  };

  const rampage = play(true);
  const quiet = play(false);

  assert.ok(rampage.deeds > quiet.deeds, 'starting wars must go on the record');
  assert.ok(rampage.threat > quiet.threat + 0.1, 'and must make you visibly more threatening');
  assert.ok(
    rampage.warmth < quiet.warmth,
    `the world should cool on an aggressor: ${rampage.warmth.toFixed(1)} vs ${quiet.warmth.toFixed(1)}`,
  );
});

test('winning somebody else\'s war can leave you holding their ground', () => {
  // Not a bug: a coalition that overruns an aggressor has to give the occupied
  // territory to somebody, and it goes to whoever did the fighting. The point
  // is that it then counts against them like any other conquest.
  const game = createGame({ playerNationId: 'usa', seed: 'quiet', totalTurns: 60 });
  for (let q = 0; q < 16 && game.status === 'active'; q++) {
    advanceTurn(game, { orders: [], decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null });
  }
  const absorbed = Object.values(game.nations).filter((n) => n.sovereign === false);
  for (const state of absorbed) {
    assert.ok(state.annexedBy, 'an absorbed state must record who took it');
    assert.ok(
      aggressionScore(game, state.annexedBy) > 0,
      'and whoever took it must have it on their record',
    );
  }
});
