// Escalation ladders and chain reactions.
//
// Every provocative order carries an escalation level. Using one against a
// country pushes that *pair* up a shared ladder, and the ladder decides how
// hard the world answers back: who retaliates, whether their allies pile in,
// and — critically — how many links the chain runs for. Low on the ladder a
// sanction draws a protest note. High on it, the same sanction sets off
// counter-sanctions, an allied boycott, a covert reprisal and a mobilisation
// in the same quarter.

import { NATIONS_BY_ID } from '../data/nations.js';
import { applyEffect } from './effects.js';
import {
  adjustRelation,
  clamp,
  combatPower,
  getRelation,
  logEvent,
  relationKey,
} from './state.js';
import { declareWar, findWar } from './war.js';
import { t, tNation } from '../i18n/index.js';

/** How provocative each order is, 0 (harmless) to 5 (open hostilities). */
export const ESCALATION_LEVELS = {
  condemn: 1,
  crackdown: 1,
  austerity: 1,
  espionage: 2,
  sanctions: 2,
  'arms-transfer': 2,
  exercises: 1,
  'cyber-op': 3,
  'forward-deploy': 3,
  destabilise: 4,
  'nuclear-programme': 4,
  intervene: 5,
};

export const LADDER_MAX = 10;

/** The rungs a wronged country can answer with, cheapest first. */
const RESPONSES = [
  {
    level: 1,
    id: 'protest',
    label: 'Diplomatic protest',
    describe: (a, b) => t('consequence.protest', '{a} summons the {b} ambassador and lodges a formal protest.', { a, b }),
    apply: () => ({ relation: -5, self: { approval: 1 } }),
  },
  {
    level: 2,
    id: 'expulsions',
    label: 'Expulsions and counter-measures',
    describe: (a, b) => t('consequence.expulsions', '{a} expels {b} diplomats and freezes the files that were still moving.', { a, b }),
    apply: (rng) => ({
      relation: -rng.float(8, 14),
      target: { influence: -rng.float(0.5, 2) },
      worldTension: rng.float(1, 3),
    }),
  },
  {
    level: 2,
    id: 'counter-sanctions',
    label: 'Counter-sanctions',
    describe: (a, b) => t('consequence.counter-sanctions', '{a} answers in kind: {b} firms lose market access and banking lines.', { a, b }),
    apply: (rng) => ({
      relation: -rng.float(9, 16),
      targetModifier: { label: 'Counter-sanctions', turns: 5, growth: -rng.float(0.12, 0.3) },
      worldTension: rng.float(2, 4),
    }),
  },
  {
    level: 3,
    id: 'posturing',
    label: 'Military signalling',
    describe: (a, b) => t('consequence.posturing', '{a} surges patrols and moves formations toward the {b} frontier.', { a, b }),
    apply: (rng) => ({
      self: { readiness: rng.float(2, 5) },
      target: { readiness: rng.float(0.5, 2) },
      relation: -rng.float(8, 15),
      worldTension: rng.float(4, 8),
    }),
  },
  {
    level: 3,
    id: 'proxy',
    label: 'Proxy pressure',
    describe: (a, b) => t('consequence.proxy', '{a} quietly resumes shipments to everyone with a grievance against {b}.', { a, b }),
    apply: (rng) => ({
      target: { unrest: rng.float(2, 5), stability: -rng.float(1, 3) },
      relation: -rng.float(6, 12),
      worldTension: rng.float(2, 5),
    }),
  },
  {
    level: 4,
    id: 'covert-reprisal',
    label: 'Covert reprisal',
    describe: (a, b) => t('consequence.covert-reprisal', '{a} answers below the threshold: {b} infrastructure starts failing in ways nobody will claim.', { a, b }),
    apply: (rng) => ({
      target: { stability: -rng.float(2, 5), readiness: -rng.float(2, 5), unrest: rng.float(2, 6) },
      targetModifier: { label: 'Sabotage and intrusions', turns: 4, growth: -rng.float(0.15, 0.35) },
      relation: -rng.float(12, 20),
      worldTension: rng.float(4, 9),
    }),
  },
  {
    level: 5,
    id: 'mobilisation',
    label: 'General mobilisation',
    describe: (a, b) => t('consequence.mobilisation', '{a} orders general mobilisation. Reservists are recalled and the {b} embassy starts burning paper.', { a, b }),
    apply: (rng) => ({
      self: { readiness: rng.float(5, 10), unrest: rng.float(1, 4) },
      relation: -rng.float(16, 26),
      worldTension: rng.float(8, 15),
    }),
  },
];

export function ladderKey(a, b) {
  return relationKey(a, b);
}

export function ladderLevel(game, a, b) {
  return game.escalation?.[ladderKey(a, b)] ?? 0;
}

/** Escalation cools off on its own, slowly, when nobody pokes it. */
export function decayLadders(game) {
  if (!game.escalation) return;
  for (const key of Object.keys(game.escalation)) {
    const next = game.escalation[key] - 0.7;
    if (next <= 0.05) delete game.escalation[key];
    else game.escalation[key] = Number(next.toFixed(3));
  }
}

function raiseLadder(game, a, b, amount) {
  if (!game.escalation) game.escalation = {};
  const key = ladderKey(a, b);
  game.escalation[key] = clamp((game.escalation[key] ?? 0) + amount, 0, LADDER_MAX);
  return game.escalation[key];
}

/** How far up the ladder a country is willing to answer. */
function chooseResponse(rng, ladder, minLevel) {
  const ceiling = Math.min(5, Math.max(minLevel, Math.round(1 + ladder / 2)));
  const options = RESPONSES.filter((r) => r.level <= ceiling && r.level >= Math.max(1, minLevel - 1));
  if (!options.length) return RESPONSES[0];
  // Bias toward the top of what they are prepared to do.
  return rng.weighted(options, (r) => r.level ** 2);
}

/**
 * Run the chain reaction provoked by one order.
 *
 * @returns {Array<object>} chain entries, in the order they happened
 */
export function resolveConsequences(game, rng, mods, outcome) {
  const level = escalationOf(outcome);
  if (!level || !outcome.targetId) return [];
  if (!game.nations[outcome.targetId]) return [];

  const provoker = outcome.actorId;
  const victim = outcome.targetId;
  const landed = outcome.tier === 'critical' || outcome.tier === 'success' || outcome.tier === 'partial';

  // A failed provocation still annoys them, just less. Gains taper near the
  // top so the last rungs have to be fought for and cannot simply be pegged.
  const before = ladderLevel(game, provoker, victim);
  const ladder = raiseLadder(
    game,
    provoker,
    victim,
    level * (landed ? 1 : 0.5) * (1 - before / (LADDER_MAX + 2)),
  );

  // The whole point: the higher the ladder, the longer the chain runs and the
  // higher the rungs it reaches.
  const maxLinks = Math.min(5, 1 + Math.floor(ladder / 2));
  const chain = [];
  let rung = level;

  for (let link = 0; link < maxLinks; link++) {
    const state = game.nations[victim];
    const capability = clamp(state.stability / 100 + state.readiness / 200, 0.2, 1.2);
    // Each further link is a little less likely, so chains taper rather than
    // running to the cap every time.
    const chance = clamp(
      (0.34 + ladder * 0.08) * capability * mods.aiAggression - link * 0.12,
      0,
      0.95,
    );
    if (!rng.bool(chance)) break;

    const response = chooseResponse(rng, ladder, rung);
    const applied = applyEffect(game, victim, provoker, response.apply(rng), { tensionScale: 0.55 });

    chain.push({
      type: 'consequence',
      link,
      actorId: victim,
      targetId: provoker,
      level: response.level,
      responseId: response.id,
      label: response.label,
      text: response.describe(tNation(NATIONS_BY_ID[victim]), tNation(NATIONS_BY_ID[provoker])),
      changes: applied.changes,
      involvesPlayer: victim === game.playerId || provoker === game.playerId,
    });

    raiseLadder(game, provoker, victim, response.level * 0.35 * (1 - ladder / (LADDER_MAX + 2)));

    // Once things are hot, the rungs climb rather than repeating.
    rung = Math.min(5, response.level + (ladder >= 6 ? 1 : 0));

    // Their friends join in; higher up the ladder, so do yours.
    if (link >= 1 && response.level >= 2) {
      chain.push(...alliedPileOn(game, rng, victim, provoker, response.level));
    }
    if (link >= 2 && ladder >= 6) {
      chain.push(...alliedPileOn(game, rng, provoker, victim, response.level - 1));
    }
  }

  // Top of the ladder: somebody stops writing notes.
  const finalLadder = ladderLevel(game, provoker, victim);
  if (finalLadder >= 8.5 && !findWar(game, provoker, victim)) {
    const aggressor = combatPower(game, victim) > combatPower(game, provoker) ? victim : provoker;
    const other = aggressor === victim ? provoker : victim;
    const warChance = 0.1 + (finalLadder - 8.5) * 0.18;
    if (rng.bool(warChance * mods.aiAggression) && aggressor !== game.playerId) {
      const war = declareWar(game, aggressor, other, { rng, reason: 'the escalation ran out of rungs' });
      if (war) {
        chain.push({
          type: 'consequence',
          link: maxLinks,
          actorId: aggressor,
          targetId: other,
          level: 5,
          responseId: 'war',
          label: 'Hostilities',
          text: t('consequence.war', 'The exchange runs out of rungs: {a} opens hostilities against {b}.', {
            a: tNation(NATIONS_BY_ID[aggressor]),
            b: tNation(NATIONS_BY_ID[other]),
          }),
          changes: [],
          involvesPlayer: aggressor === game.playerId || other === game.playerId,
        });
      }
    }
  }

  for (const entry of chain) {
    if (entry.involvesPlayer) {
      logEvent(game, {
        type: 'consequence',
        severity: entry.level >= 4 ? 'major' : 'info',
        text: entry.text,
        nations: [entry.actorId, entry.targetId],
      });
    }
  }

  return chain;
}

/** Friends of the wronged party adding their own, smaller, retaliation. */
function alliedPileOn(game, rng, responderId, againstId, level) {
  const entries = [];
  const allies = Object.keys(game.nations).filter(
    (id) =>
      id !== responderId &&
      id !== againstId &&
      getRelation(game, id, responderId) >= 55 &&
      getRelation(game, id, againstId) < 20,
  );
  if (!allies.length) return entries;

  const joiner = rng.weighted(allies, (id) => getRelation(game, id, responderId) / 20);
  if (!joiner || !rng.bool(0.45)) return entries;

  const applied = applyEffect(
    game,
    joiner,
    againstId,
    {
      relation: -rng.float(6, 14),
      targetModifier: { label: 'Allied pressure', turns: 3, growth: -rng.float(0.06, 0.18) },
      worldTension: rng.float(1, 3),
    },
    { tensionScale: 0.5 },
  );

  entries.push({
    type: 'consequence',
    depth: 99,
    actorId: joiner,
    targetId: againstId,
    level: Math.max(1, level - 1),
    responseId: 'allied-pressure',
    label: 'Allied pressure',
    text: t('consequence.allied-pressure', '{joiner} lines up behind {friend} and applies its own measures against {target}.', {
      joiner: tNation(NATIONS_BY_ID[joiner]),
      friend: tNation(NATIONS_BY_ID[responderId]),
      target: tNation(NATIONS_BY_ID[againstId]),
    }),
    changes: applied.changes,
    involvesPlayer: joiner === game.playerId || againstId === game.playerId,
  });
  return entries;
}

/** Domestic blowback from unpopular orders that have no foreign target. */
export function domesticBlowback(game, rng, mods, outcome) {
  const level = ESCALATION_LEVELS[outcome.actionId] ?? 0;
  if (outcome.targetId || !level) return [];
  if (outcome.actorId !== game.playerId) return [];

  const state = game.nations[outcome.actorId];
  const pressure = state.unrest / 100 + (outcome.tier === 'backfire' ? 0.5 : 0);
  if (!rng.bool(clamp(pressure * 0.7 * mods.unrestMultiplier, 0, 0.8))) return [];

  const applied = applyEffect(game, outcome.actorId, null, {
    self: { unrest: rng.float(2, 6) * mods.unrestMultiplier, approval: -rng.float(2, 5) },
    modifier: { label: 'Strikes and stoppages', turns: 3, growth: -rng.float(0.08, 0.22) },
  });

  const entry = {
    type: 'consequence',
    depth: 0,
    actorId: outcome.actorId,
    targetId: null,
    level,
    responseId: 'domestic-blowback',
    label: 'Domestic blowback',
    text: t('consequence.blowback', '{action} draws strikes and stoppages at home. The unions found the one lever your government still cares about.',
      { action: outcome.actionName }),
    changes: applied.changes,
    involvesPlayer: true,
  };
  logEvent(game, { type: 'consequence', severity: 'info', text: entry.text, nations: [outcome.actorId] });
  return [entry];
}

function escalationOf(outcome) {
  if (outcome.escalation !== undefined) return outcome.escalation;
  return ESCALATION_LEVELS[outcome.actionId] ?? 0;
}

/** Reads the ladder for the UI: 0-10 with a plain-language band. */
export function describeLadder(value) {
  if (value >= 8.5) return { band: 'brink', label: 'On the brink' };
  if (value >= 6) return { band: 'severe', label: 'Severe' };
  if (value >= 3.5) return { band: 'elevated', label: 'Elevated' };
  if (value >= 1.5) return { band: 'strained', label: 'Strained' };
  return { band: 'calm', label: 'Calm' };
}

/** Every ladder the player is currently on, hottest first. */
export function playerLadders(game) {
  if (!game.escalation) return [];
  const out = [];
  for (const [key, value] of Object.entries(game.escalation)) {
    const [a, b] = key.split('|');
    if (a !== game.playerId && b !== game.playerId) continue;
    const other = a === game.playerId ? b : a;
    if (!game.nations[other]) continue;
    out.push({ id: other, value, ...describeLadder(value) });
  }
  return out.sort((x, y) => y.value - x.value);
}
