import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJson } from '../src/ai/client.js';
import { sanitizeBriefing, sanitizeCustomAction } from '../src/ai/schema.js';
import { PROVIDERS, PROVIDERS_BY_ID, defaultAiConfig } from '../src/ai/providers.js';
import { offlineBriefing, offlineOpening } from '../src/ai/offline.js';
import { createGame } from '../src/engine/state.js';
import { advanceTurn } from '../src/engine/turn.js';

// ── Providers ──────────────────────────────────────────────────────────────

test('every provider is completely specified', () => {
  const ids = new Set();
  for (const p of PROVIDERS) {
    assert.ok(!ids.has(p.id), `duplicate provider: ${p.id}`);
    ids.add(p.id);
    assert.ok(p.label && p.blurb, `${p.id} needs a label and blurb`);
    assert.ok(['none', 'openai', 'gemini'].includes(p.kind), `${p.id} bad kind`);
    if (p.kind !== 'none') {
      assert.equal(typeof p.endpoint, 'function', `${p.id} needs an endpoint builder`);
      assert.ok(p.endpoint(p.defaultModel, { endpoint: 'http://x/y' }).startsWith('http'));
    }
  }
  assert.equal(defaultAiConfig().providerId, 'offline', 'the game must default to needing no key');
  assert.ok(PROVIDERS.length >= 6, 'several free options should be offered');
});

test('every keyed provider links somewhere to get a free key', () => {
  for (const p of PROVIDERS) {
    if (p.requiresKey) assert.ok(p.signupUrl?.startsWith('https://'), `${p.id} needs a signup link`);
  }
});

// ── JSON extraction from model output ──────────────────────────────────────

test('extractJson handles clean, fenced and prefixed responses', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('```\n{"a":3}\n```'), { a: 3 });
  assert.deepEqual(extractJson('Sure! Here you go:\n{"a":4}\nHope that helps.'), { a: 4 });
  assert.deepEqual(extractJson('{"nested":{"b":{"c":5}}}').nested.b, { c: 5 });
});

test('extractJson is not fooled by braces inside strings', () => {
  const value = extractJson('prefix {"text":"a } brace","ok":true} suffix');
  assert.deepEqual(value, { text: 'a } brace', ok: true });
});

test('extractJson returns null rather than throwing on junk', () => {
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{ broken'), null);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
  assert.equal(extractJson('[1,2,3]'), null, 'top-level arrays are not accepted');
});

// ── Custom action sanitisation ─────────────────────────────────────────────

const ctx = {
  validNationIds: new Set(['usa', 'chn', 'fra']),
  playerId: 'fra',
  orderText: 'Do something clever',
};

test('a well-formed adjudication survives intact', () => {
  const result = sanitizeCustomAction(
    {
      feasible: true,
      name: 'Quiet lithium buy-up',
      category: 'economy',
      targetId: 'chn',
      costPctGdp: 1.2,
      politicalCapital: 3,
      successChance: 0.6,
      risk: 'medium',
      skills: [{ stat: 'influence', weight: 0.2 }],
      onSuccess: { self: { influence: 3 }, relation: -8, modifier: { label: 'Offtake locked', turns: 6, growth: 0.2 } },
      onFailure: { self: { approval: -3 } },
      rationale: 'Plausible over a quarter.',
    },
    ctx,
  );

  assert.equal(result.feasible, true);
  assert.equal(result.targetId, 'chn');
  assert.equal(result.action.category, 'economy');
  assert.equal(result.action.cost.pctGdp, 1.2);
  assert.equal(result.action.pc, 3);
  assert.deepEqual(result.action.skills, [['influence', 0.2]]);
  assert.equal(result.action.effects.success.modifier.turns, 6);
});

test('absurd numbers from the model are clamped, not trusted', () => {
  const result = sanitizeCustomAction(
    {
      feasible: true,
      name: 'x'.repeat(500),
      category: 'not-a-category',
      costPctGdp: -99,
      politicalCapital: 99,
      successChance: 4,
      risk: 'catastrophic',
      onSuccess: {
        self: { military: 900, tech: 900, stability: 900, gdpPct: 400 },
        relation: 9000,
        worldTension: -9000,
        modifier: { label: 'forever', turns: 999, growth: 50 },
      },
      onFailure: { self: { approval: -900 } },
    },
    ctx,
  );

  const a = result.action;
  assert.ok(a.name.length <= 70);
  assert.equal(a.category, 'diplomacy', 'unknown categories fall back');
  assert.equal(a.risk, 'medium');
  assert.ok(a.cost.pctGdp >= 0 && a.cost.pctGdp <= 4);
  assert.ok(a.pc >= 1 && a.pc <= 5);
  assert.ok(a.baseSuccess <= 0.88);
  assert.equal(a.effects.success.self.military, 12);
  assert.equal(a.effects.success.self.gdpPct, 4);
  assert.equal(a.effects.success.relation, 35);
  assert.equal(a.effects.success.worldTension, -14);
  assert.equal(a.effects.success.modifier.turns, 10);
  assert.equal(a.effects.success.modifier.growth, 0.6);
  assert.equal(a.effects.failure.self.approval, -12);
});

test('the model cannot invent countries or target the player', () => {
  assert.equal(sanitizeCustomAction({ feasible: true, targetId: 'atlantis' }, ctx).targetId, null);
  assert.equal(sanitizeCustomAction({ feasible: true, targetId: 'fra' }, ctx).targetId, null);
  assert.equal(sanitizeCustomAction({ feasible: true, targetId: 'USA' }, ctx).targetId, 'usa');
  assert.equal(sanitizeCustomAction({ feasible: true, targetId: 42 }, ctx).targetId, null);
});

test('the model cannot smuggle unknown stat fields through', () => {
  const result = sanitizeCustomAction(
    { feasible: true, onSuccess: { self: { nukes: 500, treasury: 1e9, victory: true } } },
    ctx,
  );
  const self = result.action.effects.success.self || {};
  assert.equal(self.nukes, undefined, 'warheads are not grantable by prose');
  assert.equal(self.treasury, undefined);
  assert.equal(self.victory, undefined);
});

test('an infeasible verdict is reported as a refusal', () => {
  const result = sanitizeCustomAction(
    { feasible: false, rationale: 'You do not have a navy.' },
    ctx,
  );
  assert.equal(result.feasible, false);
  assert.equal(result.refusal, 'You do not have a navy.');
});

test('garbage input yields null rather than a broken action', () => {
  assert.equal(sanitizeCustomAction(null, ctx), null);
  assert.equal(sanitizeCustomAction('a string', ctx), null);
});

// ── Briefing sanitisation ──────────────────────────────────────────────────

test('briefings are trimmed and bounded', () => {
  const clean = sanitizeBriefing({
    headline: 'h'.repeat(400),
    briefing: Array.from({ length: 20 }, (_, i) => `para ${i}`),
    dispatches: Array.from({ length: 20 }, () => ({ source: 'Wire', text: 'something' })),
    advisorNote: 'note',
    outlook: 'outlook',
  });
  assert.ok(clean.headline.length <= 140);
  assert.equal(clean.briefing.length, 5);
  assert.equal(clean.dispatches.length, 5);
});

test('a briefing given as one string still works', () => {
  const clean = sanitizeBriefing({ headline: 'Hi', briefing: 'one long paragraph' });
  assert.deepEqual(clean.briefing, ['one long paragraph']);
  assert.deepEqual(clean.dispatches, []);
});

test('an empty briefing is rejected so the local fallback takes over', () => {
  assert.equal(sanitizeBriefing({}), null);
  assert.equal(sanitizeBriefing(null), null);
  assert.equal(sanitizeBriefing({ dispatches: [{ source: 'x' }] }), null);
});

// ── Offline narrator ───────────────────────────────────────────────────────

test('the offline narrator produces a usable briefing with no provider', () => {
  const game = createGame({ playerNationId: 'idn', difficulty: 6, seed: 'offline' });

  const opening = offlineOpening(game);
  assert.ok(opening.headline.includes('Indonesia'));
  assert.ok(opening.briefing.length >= 3);
  assert.ok(opening.advisorNote);

  const report = advanceTurn(game, { orders: [{ actionId: 'industrial-policy' }] });
  const brief = offlineBriefing(game, report);
  assert.ok(brief.headline.length > 0 && brief.headline.length < 140);
  assert.ok(brief.briefing.length >= 2);
  assert.ok(brief.outlook);
  for (const paragraph of brief.briefing) {
    assert.ok(!paragraph.includes('undefined'), `leaked undefined: ${paragraph}`);
    assert.ok(!paragraph.includes('NaN'), `leaked NaN: ${paragraph}`);
  }
});

test('the offline narrator holds up across a whole run', () => {
  const game = createGame({ playerNationId: 'pak', difficulty: 9, seed: 'offline-long', totalTurns: 30 });
  while (game.status === 'active') {
    const report = advanceTurn(game, {
      orders: [{ actionId: 'crackdown' }],
      decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
    });
    const brief = offlineBriefing(game, report);
    assert.ok(brief.headline && brief.briefing.length);
    for (const d of brief.dispatches) assert.ok(d.source && d.text);
  }
});
