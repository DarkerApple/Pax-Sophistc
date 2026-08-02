// Paper, and what it is worth: treaties that bind, allies that come (or do
// not), and wars that get called something a person would say out loud.

import test from 'node:test';
import assert from 'node:assert/strict';

import { NATIONS } from '../src/data/nations.js';
import { ACTIONS, ACTIONS_BY_ID, CATEGORIES, actionAvailability, actionsInCategory } from '../src/engine/actions.js';
import { Rng } from '../src/engine/rng.js';
import { startGame } from '../src/engine/lifecycle.js';
import { advanceTurn } from '../src/engine/turn.js';
import { adjustRelation, getRelation, setRelation, sovereignIds } from '../src/engine/state.js';
import { gameModifiers } from '../src/engine/worldmodes.js';
import { resolveAction } from '../src/engine/resolve.js';
import { declareWar } from '../src/engine/war.js';
import { nameWar } from '../src/engine/warnames.js';
import {
  TREATY_KINDS,
  TREATY_LIST,
  abrogate,
  alliedAid,
  alliesOf,
  canSign,
  hasTreaty,
  invoke,
  partnersOf,
  renew,
  sign,
  tickTreaties,
  treatiesFor,
  treatyBetween,
  treatyReport,
} from '../src/engine/treaties.js';

const game = (id = 'pol', seed = 'tr') => startGame({ playerNationId: id, seed, totalTurns: 40 });

// ── Signing ─────────────────────────────────────────────────────────────────

test('a treaty exists, has a term, and can be found again', () => {
  const g = game();
  assert.deepEqual(treatiesFor(g, 'pol'), [], 'nothing is signed on day one');

  const treaty = sign(g, 'pol', 'deu', 'defence', new Rng(1));
  assert.ok(treaty);
  assert.equal(treaty.kind, 'defence');
  assert.ok(treaty.expiresTurn > g.turn, 'a treaty that never expires is not a treaty');
  assert.equal(treatiesFor(g, 'pol').length, 1);
  assert.equal(treatyBetween(g, 'deu', 'pol', 'defence').id, treaty.id, 'and it is symmetric');
  assert.ok(hasTreaty(g, 'pol', 'deu'));
  assert.deepEqual(partnersOf(g, 'pol'), ['deu']);
});

test('signing is warm, and the neighbourhood reads it', () => {
  const g = game();
  const before = getRelation(g, 'pol', 'deu');
  sign(g, 'pol', 'deu', 'defence', new Rng(1));
  assert.ok(getRelation(g, 'pol', 'deu') > before, 'the two signatories warm to each other');
  assert.ok(g.log.some((e) => e.type === 'treaty'), 'and it is on the record');
});

test('you cannot sign what they would not sign', () => {
  const g = game();
  setRelation(g, 'pol', 'rus', -80);
  const cold = canSign(g, 'pol', 'rus', 'defence');
  assert.equal(cold.ok, false);
  assert.match(cold.reason, /relations/i, 'and it says what it would take');

  const warm = canSign(g, 'pol', 'deu', 'nonaggression');
  assert.equal(warm.ok, true);
  assert.ok(warm.chance > 0 && warm.chance < 1);

  sign(g, 'pol', 'deu', 'nonaggression', new Rng(1));
  assert.equal(canSign(g, 'pol', 'deu', 'nonaggression').ok, false, 'and never twice');
});

test('an extended deterrence guarantee needs something to extend', () => {
  const g = game('pol', 'umb');
  g.nations.pol.nukes = 0;
  setRelation(g, 'pol', 'cze', 80);
  assert.equal(canSign(g, 'pol', 'cze', 'umbrella').ok, false);
  g.nations.pol.nukes = 40;
  assert.equal(canSign(g, 'pol', 'cze', 'umbrella').ok, true);
});

test('treaties lapse if nobody renews them, and renewal pushes the clock back', () => {
  const g = game();
  const treaty = sign(g, 'pol', 'deu', 'trade', new Rng(1));
  g.turn = treaty.expiresTurn;
  const { expired } = tickTreaties(g, new Rng(2));
  assert.equal(expired.length, 1);
  assert.equal(treatiesFor(g, 'pol').length, 0);
  assert.equal(treaty.ending, 'lapsed');

  const h = game('pol', 'tr2');
  const second = sign(h, 'pol', 'deu', 'trade', new Rng(1));
  h.turn = second.expiresTurn - 1;
  renew(h, second.id);
  assert.ok(second.expiresTurn > h.turn + 10, 'renewal has to actually buy time');
});

test('tearing one up costs standing, and everybody else with your signature notices', () => {
  const g = game();
  sign(g, 'pol', 'deu', 'defence', new Rng(1));
  const other = sign(g, 'pol', 'cze', 'trade', new Rng(2));
  const influence = g.nations.pol.influence;
  const cred = other.credibility;

  const done = abrogate(g, treatyBetween(g, 'pol', 'deu').id, 'pol');
  assert.equal(done.ok, true);
  assert.ok(g.nations.pol.influence < influence, 'walking away has to cost standing');
  assert.ok(other.credibility < cred, 'and every other treaty you hold is worth less');
  assert.equal(hasTreaty(g, 'pol', 'deu'), false);
});

// ── Allies ──────────────────────────────────────────────────────────────────

test('allies come from real paper and from blocs that are actually alliances', () => {
  const g = game();
  const blocOnly = alliesOf(g, 'pol');
  assert.ok(blocOnly.length > 0, 'Poland starts in NATO');
  assert.ok(blocOnly.every((a) => a.via === 'bloc'));

  sign(g, 'pol', 'ukr', 'alliance', new Rng(1));
  const withPaper = alliesOf(g, 'pol');
  const ukr = withPaper.find((a) => a.id === 'ukr');
  assert.ok(ukr);
  assert.equal(ukr.via, 'treaty');
  assert.ok(withPaper[0].weight >= withPaper[withPaper.length - 1].weight, 'heaviest obligation first');
});

test('a defence pact pulls the partner into a war they had no part in', () => {
  const g = game('cze', 'pull');
  setRelation(g, 'cze', 'aus', 70);
  sign(g, 'cze', 'aus', 'defence', new Rng(1));

  const war = declareWar(g, 'rus', 'cze', { rng: new Rng(11), reason: 'territorial claims' });
  assert.ok(war);
  assert.ok(war.defenders.includes('aus'), 'the pact has to actually mean something');
});

test('a defence pact does not cover a war you started; a full alliance does', () => {
  // Measured over many seeds rather than one: the coverage rule is a large
  // difference in willingness, not a hard gate, and one roll cannot show that.
  const joinRate = (kind) => {
    let joined = 0;
    for (let seed = 0; seed < 40; seed++) {
      const g = game('pol', `inv-${kind}-${seed}`);
      setRelation(g, 'pol', 'che', 85);
      sign(g, 'pol', 'che', kind, new Rng(seed + 1));
      // Switzerland is in no bloc, so it is only ever in this war by invitation,
      // and Algeria drags nobody else in.
      const war = declareWar(g, 'pol', 'dza', { rng: new Rng(seed + 50), reason: 'claims' });
      if (!war) continue;
      // Either they came in with the declaration, or they came when called.
      // Both count: the question is whether they ended up fighting your war.
      if (!war.attackers.includes('che')) invoke(g, war, 'pol', new Rng(seed + 90));
      if (war.attackers.includes('che')) joined += 1;
    }
    return joined / 40;
  };

  const underDefence = joinRate('defence');
  const underAlliance = joinRate('alliance');
  assert.ok(
    underAlliance > underDefence + 0.3,
    `an alliance must cover an offensive war and a defence pact must not: ${underAlliance} vs ${underDefence}`,
  );
  assert.ok(underDefence < 0.4, `a defence pact answered an offensive call ${underDefence * 100}% of the time`);
});

test('refusing a call you were obliged to answer destroys the paper', () => {
  const g = game('cze', 'refuse');
  setRelation(g, 'cze', 'aus', 70);
  const treaty = sign(g, 'cze', 'aus', 'defence', new Rng(1));
  const war = declareWar(g, 'rus', 'cze', { rng: new Rng(2), reason: 'claims' });
  // Take the ally back out so the call is real, then have them refuse.
  war.defenders = war.defenders.filter((id) => id !== 'aus');
  const before = treaty.credibility;

  const rng = new Rng(3);
  rng.bool = () => false;
  const answer = invoke(g, war, 'cze', rng);

  assert.ok(answer.refused.some((a) => a.id === 'aus'));
  assert.ok(treaty.credibility < before - 10, 'a refusal has to be expensive');
  assert.ok(g.log.some((e) => e.type === 'treaty' && /nobody moves|아무도/.test(e.text)));
});

test('allies who stay out still send money and materiel', () => {
  const g = game('cze', 'aid');
  setRelation(g, 'cze', 'aus', 80);
  sign(g, 'cze', 'aus', 'defence', new Rng(1));
  const war = declareWar(g, 'rus', 'cze', { rng: new Rng(2), reason: 'claims' });
  war.defenders = war.defenders.filter((id) => id !== 'aus');

  const treasury = g.nations.cze.treasury;
  const rng = new Rng(4);
  rng.bool = () => true;
  const sent = alliedAid(g, rng);

  assert.ok(sent.some((s) => s.to === 'cze'), 'somebody should have sent something');
  assert.ok(g.nations.cze.treasury > treasury, 'and it should show up in the books');
});

test('the treaty report is what the panel needs, and nothing it does not', () => {
  const g = game();
  sign(g, 'pol', 'deu', 'defence', new Rng(1));
  const report = treatyReport(g);
  assert.equal(report.live.length, 1);
  assert.equal(report.live[0].other, 'deu');
  assert.ok(report.live[0].otherDef.name);
  assert.ok(report.live[0].quartersLeft > 0);
  assert.ok(report.allies.length > 0);
});

// ── The orders ──────────────────────────────────────────────────────────────

test('there is an order for every kind of treaty, and an Alliances tab to find it in', () => {
  assert.ok(CATEGORIES.some((c) => c.id === 'alliances'), 'the tab has to exist');
  for (const kind of TREATY_LIST) {
    const order = ACTIONS_BY_ID[`propose-${kind.id}`];
    assert.ok(order, `no way to propose a ${kind.id}`);
    assert.equal(order.category, 'alliances');
    assert.equal(order.formsPact, kind.id);
  }
  assert.ok(ACTIONS_BY_ID['withdraw-from-treaty']);
  assert.ok(ACTIONS_BY_ID['invoke-the-treaties']);
  assert.ok(ACTIONS_BY_ID['renew-the-paper']);
});

test('proposing a treaty through an order actually signs one', () => {
  const g = game();
  g.politicalCapital = 12;
  const rng = new Rng(1);
  rng.next = () => 0; // forced through: the point is the structural change

  resolveAction(g, rng, gameModifiers(g), { actionId: 'propose-defence', targetId: 'deu' }, 'pol');
  assert.ok(hasTreaty(g, 'pol', 'deu', 'defence'), 'the order has to produce paper');
});

test('a treaty order is not offered against a country that would not sign', () => {
  const g = game();
  setRelation(g, 'pol', 'rus', -90);
  const order = ACTIONS_BY_ID['propose-defence'];
  assert.equal(order.availableAgainst(g, 'rus'), false);
  assert.equal(actionAvailability(g, order, 'rus').ok, false);
});

test('every category has an icon and every icon is distinct', () => {
  const icons = CATEGORIES.map((c) => c.icon);
  assert.equal(new Set(icons).size, icons.length, 'two tabs with the same mark is one tab too many');
  for (const c of CATEGORIES) assert.ok(c.icon && c.name, `${c.id} is missing an icon or a name`);
});

test('the war room is deep enough to be worth opening', () => {
  const wartime = ACTIONS.filter((a) => a.category === 'war');
  assert.ok(wartime.length >= 40, `only ${wartime.length} wartime orders`);
  // And most of them move the front rather than only the statistics.
  const operational = wartime.filter((a) => a.warEffect || a.warCommand);
  assert.ok(operational.length >= 20, `only ${operational.length} of them touch the front`);
});

// ── Capitals ────────────────────────────────────────────────────────────────

test('every country has a capital', () => {
  for (const nation of NATIONS) {
    assert.ok(nation.capital, `${nation.id} has no seat of government`);
  }
});

// ── War names ───────────────────────────────────────────────────────────────

test('a war is named for the ground it is fought over', () => {
  const g = game('usa', 'names');
  const naming = nameWar(g, 'chn', 'twn', { reason: 'territorial claims', rng: new Rng(3) });
  assert.match(naming.name, /^The /);
  assert.ok(!naming.name.includes('–'), 'not two adjectives joined by a dash');
  // Taiwan's theatre must be somewhere near Taiwan.
  assert.ok(
    ['the Strait', 'the South China Sea', 'the Yellow Sea', 'the Peninsula', 'the Amur'].includes(naming.theatre),
    `Taiwan should not be fought over in ${naming.theatre}`,
  );
});

test('a great power falling on a small one is remembered as an intervention', () => {
  const g = game('usa', 'names2');
  const shapes = new Set();
  for (let i = 0; i < 12; i++) {
    shapes.add(nameWar(g, 'usa', 'cub', { reason: 'declared intervention', rng: new Rng(i + 1) }).shape);
  }
  assert.ok(shapes.has('intervention'), `never called an intervention: ${[...shapes].join(', ')}`);
});

test('the second war in the same theatre is numbered, and a dated one is not', () => {
  const g = game('usa', 'names3');
  g.wars.push({ baseName: 'Carpathians War', active: false });
  const again = nameWar(g, 'rus', 'pol', { reason: 'territorial claims', rng: new Rng(1) });
  if (again.shape === 'theatre' && again.name.includes('Carpathians')) {
    assert.match(again.name, /Second/);
  }
  // Names that already carry a year never take an ordinal.
  g.wars.push({ baseName: 'Winter War of 2026', active: false });
  for (let i = 0; i < 8; i++) {
    const dated = nameWar(g, 'usa', 'nzl', { reason: 'the escalation ran out of rungs', rng: new Rng(i) });
    if (dated.shape === 'season' || dated.shape === 'escalation') {
      assert.ok(!/Second|Third/.test(dated.name), `dated war was numbered: ${dated.name}`);
    }
  }
});

test('war names survive a whole run without collapsing into duplicates', () => {
  const g = startGame({ playerNationId: 'idn', seed: 'warnames', totalTurns: 30, difficulty: 8 });
  for (let i = 0; i < 30 && g.status === 'active'; i++) advanceTurn(g, { orders: [] });
  const names = g.wars.map((w) => w.name);
  if (names.length > 1) {
    assert.equal(new Set(names).size, names.length, `duplicate war names: ${names.join(' | ')}`);
  }
  for (const war of g.wars) {
    assert.ok(war.theatre, `${war.name} has no theatre`);
    assert.ok(war.startYear, `${war.name} has no start year`);
  }
});
