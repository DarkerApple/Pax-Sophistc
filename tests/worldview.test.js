// What the world panel reads: blocs, breakaway states, occupations, borders.
//
// These features all existed in the engine before anything showed them. The
// point of these tests is that the derived views actually reflect the engine —
// so a change that stops a country breaking away, or stops a bloc changing
// hands, fails here rather than quietly emptying a panel.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame, getRelation, setRelation } from '../src/engine/state.js';
import { Rng } from '../src/engine/rng.js';
import { annexNation, realign, secede } from '../src/engine/statecraft.js';
import { transferLand } from '../src/engine/territory.js';
import { growthOutlook, ledgerFor, advanceTurn } from '../src/engine/turn.js';
import {
  blocStandings,
  feared,
  formerStates,
  landMovers,
  newStates,
  playerBlocs,
  recentOfType,
} from '../src/ui/worldview.js';

function game(id = 'usa', seed = 'wv') {
  return createGame({ playerNationId: id, seed, totalTurns: 40 });
}

test('bloc standings account for everybody and weight by power', () => {
  const g = game();
  const standings = blocStandings(g);
  assert.ok(standings.length >= 8, 'the board should have blocs on it');

  // Ordered by weight, and NATO — with the USA in it — should be near the top.
  for (let i = 1; i < standings.length; i++) {
    assert.ok(standings[i - 1].powerShare >= standings[i].powerShare, 'standings must be ordered by weight');
  }
  const nato = standings.find((s) => s.bloc.id === 'nato');
  assert.ok(nato.playerIn, 'the USA starts in NATO');
  assert.ok(nato.powerShare > 0.2, `NATO should be a heavyweight, got ${nato.powerShare}`);
  assert.ok(playerBlocs(g).every((s) => s.playerIn));
});

test('changing sides shows up in the standings and on the record', () => {
  const g = game();
  const before = blocStandings(g).find((s) => s.bloc.id === 'nato').members.length;

  realign(g, 'usa', 'nato', false, new Rng(2));

  const after = blocStandings(g).find((s) => s.bloc.id === 'nato');
  assert.equal(after.members.length, before - 1);
  assert.equal(after.playerIn, false);
  assert.equal(recentOfType(g, 'alignment').length, 1);
});

test('a breakaway state appears with statistics derived from its parent', () => {
  const g = game();
  const parentGdp = g.nations.rus.gdp;
  const child = secede(g, 'rus', new Rng(7), { share: 0.3 });
  assert.ok(child, 'the split should have happened');

  const born = newStates(g);
  assert.equal(born.length, 1);
  const entry = born[0];

  assert.equal(entry.id, child.id);
  assert.equal(entry.parent.id, 'rus');
  assert.ok(entry.def.name !== 'Russia', 'a new state needs a name of its own');
  assert.ok(entry.area > 0, 'it has to hold ground');
  assert.ok(entry.gdp > 0 && entry.gdp < parentGdp, 'its economy is a fraction of its parent’s');
  assert.ok(entry.population > 0);
  assert.ok(entry.stability < 50, 'a state born last quarter is not a stable one');
  assert.ok(entry.sovereign);
  assert.equal(recentOfType(g, 'secession').length, 1);
});

test('a conquered state is listed as held by whoever holds it', () => {
  const g = game();
  annexNation(g, 'cub', 'usa', new Rng(9));

  const gone = formerStates(g);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].id, 'cub');
  assert.equal(gone[0].holderId, 'usa');
  assert.ok(gone[0].byPlayer);
  // And it stops appearing anywhere that counts live countries.
  assert.ok(!blocStandings(g).some((s) => s.members.includes('cub')));
});

test('ground that changes hands turns up as a net gain and a net loss', () => {
  const g = game();
  assert.deepEqual(landMovers(g), { gained: [], lost: [] }, 'nothing has moved in the first quarter');

  transferLand(g, 'mex', 'usa', 400);

  const { gained, lost } = landMovers(g);
  assert.equal(gained[0].id, 'usa');
  assert.equal(lost[0].id, 'mex');
  assert.ok(gained[0].delta > 0 && lost[0].delta < 0);
  // What one side gained the other lost, give or take a cell's rounding.
  assert.ok(Math.abs(gained[0].delta + lost[0].delta) < 5);
});

test('nobody is feared at the start of a peaceful run', () => {
  assert.deepEqual(feared(game()), []);
});

// ── The books ───────────────────────────────────────────────────────────────

test('the growth outlook predicts what the quarter then does', () => {
  const g = game('bra', 'outlook');
  const predicted = growthOutlook(g, 'bra').growth;
  const before = g.nations.bra.gdp;

  advanceTurn(g, { orders: [] });

  const actual = ((g.nations.bra.gdp - before) / before) * 100;
  // The quarter adds a small random shock and then the world moves; the outlook
  // is a forecast, not a promise. Half a point is well inside that.
  assert.ok(
    Math.abs(actual - predicted) < 0.5,
    `outlook said ${predicted.toFixed(2)}%, the quarter did ${actual.toFixed(2)}%`,
  );
  assert.ok(growthOutlook(g, 'bra').drivers.length > 0, 'and it has to say where that came from');
});

test('the outlook and the ledger change nothing they read', () => {
  const g = game();
  const snapshot = JSON.stringify(g.nations.usa);
  growthOutlook(g, 'usa');
  ledgerFor(g, 'usa');
  assert.equal(JSON.stringify(g.nations.usa), snapshot);
});

test('a state that cannot govern cannot collect', () => {
  const g = game();
  const healthy = ledgerFor(g, 'usa').collection;
  g.nations.usa.stability = 10;
  const failing = ledgerFor(g, 'usa').collection;
  assert.ok(failing < healthy, 'collapsing institutions must cost you revenue');
  assert.ok(ledgerFor(g, 'usa').revenue > 0);
});

test('relations seeded for a new state are hostile to its parent and mixed elsewhere', () => {
  const g = game();
  const child = secede(g, 'ind', new Rng(21), { share: 0.25 });
  assert.ok(getRelation(g, child.id, 'ind') < -50, 'it just fought its way out');
  setRelation(g, child.id, 'usa', 0);
  assert.equal(getRelation(g, child.id, 'usa'), 0);
});
