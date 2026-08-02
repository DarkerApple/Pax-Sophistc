// What you actually know about somebody else.
//
// Every foreign statistic used to be exact and free, which made espionage a
// stat bonus rather than a decision and made a force ratio something you could
// look up before committing to a war. Now a rival's figures arrive as a band —
// "capable, 55 to 75" — and narrow only as far as your intelligence on them
// reaches.
//
// Knowledge comes from three places and decays:
//   · structural — proximity, shared blocs, your own reach and their openness
//   · purchased  — espionage, cyber operations, signals coverage, defectors
//   · given      — allies tell you things; enemies do not
//
// The simulation is never fogged. Only the reading is. A war fought on a
// misjudged ratio is fought at the true ratio, which is the entire point.

import { blocsOf, clamp, defOf, getRelation, proximity } from './state.js';
import { t } from '../i18n/index.js';

/** How long a purchased look at somebody lasts before it is stale. */
const INTEL_DECAY = 0.86;

/** Orders that buy you a look, and how good a look they buy. */
export const INTEL_YIELD = {
  espionage: 0.3,
  'cyber-op': 0.22,
  'penetrate-command': 0.45,
  'defector-programme': 0.38,
  'nuclear-intelligence': 0.34,
  'signals-agency': 0.16,
  'economic-intelligence': 0.14,
  'intelligence-review': 0.1,
  'counter-intel': 0,
  'state-visit': 0.08,
  'make-the-state-visit': 0.08,
  'defence-pact': 0.2,
  'security-guarantee': 0.18,
};

/**
 * Everything your services can see about a country without being told, 0..1.
 *
 * Being next door, sharing a bloc, being an open society and being watched by a
 * capable service all count. A distant closed state you have no relationship
 * with is very nearly opaque.
 */
export function baselineIntel(game, id) {
  if (id === game.playerId) return 1;
  const you = game.nations[game.playerId];
  const them = game.nations[id];
  const yourDef = defOf(game, game.playerId);
  const theirDef = defOf(game, id);
  if (!you || !them || !yourDef || !theirDef) return 0;

  const near = proximity(yourDef, theirDef); // 0..1
  const shared = blocsOf(game, id).filter((b) => blocsOf(game, game.playerId).includes(b)).length;
  const relation = getRelation(game, game.playerId, id);

  // Your own capability to look, and their capability to hide.
  const service = (you.tech * 0.6 + you.influence * 0.4) / 100;
  const opacity = clamp(them.stability / 140 + (100 - them.influence) / 260, 0, 0.8);

  const raw =
    0.16 +
    near * 0.24 +
    Math.min(0.22, shared * 0.11) +
    Math.max(0, relation) / 420 +
    service * 0.3 -
    opacity * 0.35;

  return Number(clamp(raw, 0.05, 0.95).toFixed(3));
}

/** What you have bought on top of that, from orders you actually ran. */
export function purchasedIntel(game, id) {
  return clamp(game.intel?.[id] ?? 0, 0, 1);
}

/** The total, which is what everything else asks for. */
export function intelOn(game, id) {
  if (id === game.playerId) return 1;
  return Number(clamp(baselineIntel(game, id) + purchasedIntel(game, id), 0, 1).toFixed(3));
}

/** Record what an order bought. Called once per resolved player order. */
export function recordIntel(game, outcome) {
  if (outcome.actorId !== game.playerId || !outcome.targetId) return 0;
  const yieldOf = INTEL_YIELD[outcome.actionId];
  if (!yieldOf) return 0;
  const landed = outcome.tier === 'critical' ? 1.35
    : outcome.tier === 'success' ? 1
      : outcome.tier === 'partial' ? 0.5
        : 0;
  if (!landed) return 0;
  if (!game.intel) game.intel = {};
  const before = game.intel[outcome.targetId] ?? 0;
  game.intel[outcome.targetId] = Number(clamp(before + yieldOf * landed, 0, 0.9).toFixed(3));
  return game.intel[outcome.targetId] - before;
}

/** Sources go cold. Called once a quarter. */
export function decayIntel(game) {
  if (!game.intel) return;
  for (const id of Object.keys(game.intel)) {
    const next = game.intel[id] * INTEL_DECAY;
    if (next < 0.01) delete game.intel[id];
    else game.intel[id] = Number(next.toFixed(3));
  }
}

/** A counter-intelligence programme makes you harder to read, for everyone. */
export function hardenAgainst(game, id, amount = 0.25) {
  if (!game.intel) return;
  if (game.intel[id] === undefined) return;
  game.intel[id] = Number(clamp(game.intel[id] - amount, 0, 1).toFixed(3));
}

// ── Reading a figure ────────────────────────────────────────────────────────

/**
 * One statistic, as your services would put it.
 *
 * At full knowledge you get the number. Below that you get a band whose width
 * is set by how little you know, deterministically offset per country and
 * statistic — so a rival's estimate is stable from quarter to quarter rather
 * than jittering every render, and two different statistics are not wrong in
 * the same direction.
 *
 * @returns {{known: boolean, value: number|null, low: number, high: number,
 *            estimate: number, confidence: number, text: string}}
 */
export function estimate(game, id, key, { max = 100 } = {}) {
  const state = game.nations[id];
  const truth = Number(state?.[key] ?? 0);
  const confidence = intelOn(game, id);

  if (id === game.playerId || confidence >= 0.82) {
    return {
      known: true,
      value: truth,
      low: truth,
      high: truth,
      estimate: truth,
      confidence,
      text: formatFigure(truth, key),
    };
  }

  // Width of the band: nearly nothing at high confidence, half the scale at
  // none. Bias is deterministic in (country, statistic, key) so it does not
  // move under the player between renders, and does not correlate across
  // statistics.
  const width = (1 - confidence) ** 1.35 * max * 0.45;
  const bias = (hash(`${id}:${key}`) / 0xffffffff - 0.5) * width * 0.8;
  const centre = clamp(truth + bias, 0, max);
  const low = clamp(centre - width / 2, 0, max);
  const high = clamp(centre + width / 2, 0, max);

  return {
    known: false,
    value: null,
    low,
    high,
    estimate: centre,
    confidence,
    text: `${formatFigure(low, key)}–${formatFigure(high, key)}`,
  };
}

function formatFigure(value, key) {
  if (key === 'gdp') return `$${value.toFixed(2)}T`;
  if (key === 'population') return `${Math.round(value)}M`;
  if (key === 'nukes') return Math.round(value).toLocaleString();
  return String(Math.round(value));
}

/** A word for how well you can see a country at all. */
export function confidenceBand(confidence) {
  if (confidence >= 0.82) return { id: 'confirmed', label: 'confirmed' };
  if (confidence >= 0.62) return { id: 'good', label: 'good coverage' };
  if (confidence >= 0.42) return { id: 'partial', label: 'partial picture' };
  if (confidence >= 0.24) return { id: 'thin', label: 'thin' };
  return { id: 'dark', label: 'we are guessing' };
}

/**
 * The one estimate a player will bet a war on: how their forces compare to
 * yours, as your staff would brief it.
 *
 * Deliberately the fogged reading, not the true one. Committing to a war on a
 * ratio your services got wrong is the disaster this system exists to make
 * possible.
 */
export function estimatedBalance(game, id) {
  const you = game.nations[game.playerId];
  const mil = estimate(game, id, 'military');
  const ready = estimate(game, id, 'readiness');
  const yours = (you.military * 0.7 + you.readiness * 0.3) || 1;
  const theirLow = (mil.low * 0.7 + ready.low * 0.3) / yours;
  const theirHigh = (mil.high * 0.7 + ready.high * 0.3) / yours;
  return {
    known: mil.known,
    low: theirLow,
    high: theirHigh,
    confidence: mil.confidence,
    text: mil.known
      ? `${theirLow.toFixed(2)}×`
      : t('intel.between', '{a}× to {b}×', { a: theirLow.toFixed(2), b: theirHigh.toFixed(2) }),
  };
}

/** Countries you can see least well, which is where the surprises come from. */
export function darkest(game, ids, limit = 4) {
  return ids
    .filter((id) => id !== game.playerId)
    .map((id) => ({ id, confidence: intelOn(game, id) }))
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, limit);
}

/** Deterministic 32-bit string hash, so an estimate never moves on its own. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
