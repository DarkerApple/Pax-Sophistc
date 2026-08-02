// The one country that is about you.
//
// A world of fifty-six evenly balanced rivals reads as weather. One recurring
// antagonist reads as a story — and the machinery to find it already existed:
// escalation ladders record who has been trading blows with you, the aggression
// ledger records what they have done, relations record how it has gone.
//
// This module promotes the worst of them into a named rivalry with a dossier
// that persists across quarters and terms, remembers the specific orders that
// built it, and makes that country point its quarter at you rather than at
// whoever happened to score highest this turn.
//
// A rivalry is not permanent. Let it cool for long enough — or settle it — and
// it lapses, and somebody else can take the position.

import { aggressionScore } from './coalitions.js';
import { ladderLevel } from './consequences.js';
import {
  clamp,
  combatPower,
  defOf,
  getRelation,
  isSovereign,
  livePower,
  logEvent,
  sovereignIds,
} from './state.js';
import { t, tNation } from '../i18n/index.js';

/** How much friction it takes before a rivalry gets a name. */
const PROMOTE_AT = 3.4;
/** And how far it has to fall before it lapses. */
const LAPSE_AT = 1.6;
/** How long a single grievance stays sharp. */
const GRIEVANCE_MEMORY = 24;

/**
 * How much of a rival one country currently is, 0 upward.
 *
 * Built from the four things the engine already knows: how hot the ladder
 * between you is, how badly relations have gone, what they have done to the
 * world lately, and whether you are or have been at war.
 */
export function frictionWith(game, id) {
  if (id === game.playerId || !isSovereign(game, id)) return 0;
  const relation = getRelation(game, game.playerId, id);
  const ladder = ladderLevel(game, game.playerId, id);
  const deeds = aggressionScore(game, id);

  const wars = game.wars.filter(
    (w) =>
      (w.attackers.includes(id) && w.defenders.includes(game.playerId)) ||
      (w.defenders.includes(id) && w.attackers.includes(game.playerId)),
  );
  const fighting = wars.filter((w) => w.active).length;
  const fought = wars.length - fighting;

  // Weight by how much they can actually do about it — but only as a tilt. A
  // state half your size that has spent ten quarters hitting you is still your
  // standing problem; a state a fiftieth of your size mostly is not.
  const ratio = livePower(game, id) / Math.max(1, livePower(game, game.playerId));
  const reach = clamp(0.55 + Math.min(1.6, ratio) * 0.45, 0.55, 1.3);

  const raw =
    Math.max(0, -relation - 25) / 22 +
    ladder / 3.2 +
    Math.min(1.4, deeds / 3) +
    fighting * 2.2 +
    fought * 0.7;

  return Number((raw * reach).toFixed(3));
}

/** Everyone who has any quarrel with you at all, worst first. */
export function frictions(game) {
  return sovereignIds(game)
    .filter((id) => id !== game.playerId)
    .map((id) => ({ id, friction: frictionWith(game, id) }))
    .filter((entry) => entry.friction > 0.2)
    .sort((a, b) => b.friction - a.friction);
}

export function nemesisOf(game) {
  const dossier = game.nemesis;
  if (!dossier || !dossier.id) return null;
  if (!isSovereign(game, dossier.id)) return null;
  return dossier;
}

export function isNemesis(game, id) {
  return nemesisOf(game)?.id === id;
}

/** A grievance is one remembered thing, with who did it and how much it stung. */
export function recordGrievance(game, id, { by, actionId, label, weight = 1, text }) {
  if (!game.grievances) game.grievances = {};
  const file = game.grievances[id] || (game.grievances[id] = []);
  file.push({
    turn: game.turn,
    by, // 'them' or 'you'
    actionId: actionId || null,
    label: label || actionId || 'unspecified',
    weight: Number(weight.toFixed(2)),
    text: text || null,
  });
  // The file is a memory, not an archive.
  if (file.length > 24) file.shift();
}

/** Everything still remembered about one country, freshest first. */
export function dossierOn(game, id, { within = GRIEVANCE_MEMORY } = {}) {
  return [...(game.grievances?.[id] || [])]
    .filter((entry) => game.turn - entry.turn <= within)
    .reverse();
}

/**
 * Watch the quarter's outcomes for anything worth remembering.
 *
 * Called once with the turn report. Only things aimed at you, or that you aimed
 * at them, go in the file — the point is a record of a relationship, not of the
 * world.
 */
export function noteQuarter(game, report) {
  for (const outcome of report.worldOutcomes || []) {
    if (outcome.targetId !== game.playerId) continue;
    const level = hostilityOf(outcome);
    if (!level) continue;
    recordGrievance(game, outcome.actorId, {
      by: 'them',
      actionId: outcome.actionId,
      label: outcome.actionName,
      weight: level,
      text: outcome.text,
    });
  }
  for (const outcome of report.playerOutcomes || []) {
    if (!outcome.targetId) continue;
    const level = hostilityOf(outcome);
    if (!level) continue;
    recordGrievance(game, outcome.targetId, {
      by: 'you',
      actionId: outcome.actionId,
      label: outcome.actionName,
      weight: level,
      text: outcome.text,
    });
  }
  for (const war of report.wars || []) {
    if (!war.declared) continue;
    const [a, b] = [war.declared.attacker, war.declared.defender];
    if (b === game.playerId && a) {
      recordGrievance(game, a, { by: 'them', label: 'Declaration of war', weight: 4, text: war.declared.text });
    }
  }
}

function hostilityOf(outcome) {
  if (!outcome) return 0;
  const landed = outcome.tier === 'critical' || outcome.tier === 'success';
  const base = {
    sanctions: 1.6, espionage: 1.2, 'cyber-op': 1.8, destabilise: 2.6, condemn: 0.8,
    'forward-deploy': 1.5, 'arms-transfer': 1.2, intervene: 3.5, 'influence-operation': 2.4,
    'sabotage-programme': 2.8, 'penetrate-command': 2, 'proxy-support': 2.4,
    'war-crimes-referral': 1.8, 'freedom-of-navigation': 1.4,
  }[outcome.actionId];
  if (!base) return 0;
  return Number((base * (landed ? 1 : 0.5)).toFixed(2));
}

/**
 * Promote, keep or lapse the rivalry, once a quarter.
 *
 * @returns {{kind: 'promoted'|'replaced'|'lapsed'|'held', id?: string} | null}
 */
export function updateNemesis(game, rng) {
  const ranked = frictions(game);
  const top = ranked[0] || null;

  // A rivalry can also end because the other party stopped existing. That is
  // the loudest way for one to end, and it used to happen silently.
  if (game.nemesis?.id && !isSovereign(game, game.nemesis.id)) {
    const was = game.nemesis.id;
    const byYou = game.nations[was]?.annexedBy === game.playerId;
    archiveNemesis(game);
    game.nemesis = null;
    logEvent(game, {
      type: 'nemesis',
      severity: 'critical',
      text: byYou
        ? t('nemesis.settled',
            'The question of {nation} is settled the way these questions are usually settled. There is no longer a {nation} to have a question about.',
            { nation: tNation(defOf(game, was)) })
        : t('nemesis.settledElsewhere',
            'The question of {nation} is answered by somebody else. Your government spent years on a problem that another government removed.',
            { nation: tNation(defOf(game, was)) }),
      nations: [was],
    });
    return { kind: 'settled', id: was, byYou };
  }

  const current = nemesisOf(game);

  if (current) {
    const still = frictionWith(game, current.id);
    current.friction = still;
    current.peak = Math.max(current.peak ?? still, still);
    current.quarters = (current.quarters || 0) + 1;

    if (still < LAPSE_AT) {
      const was = current.id;
      archiveNemesis(game);
      game.nemesis = null;
      logEvent(game, {
        type: 'nemesis',
        severity: 'major',
        text: t('nemesis.lapsed',
          'The quarrel with {nation} has gone quiet. It is a normal foreign relationship again — for now.',
          { nation: tNation(defOf(game, was)) }),
        nations: [was],
      });
      return { kind: 'lapsed', id: was };
    }

    // Somebody clearly worse displaces them, but only clearly.
    if (top && top.id !== current.id && top.friction > still * 1.5 && top.friction >= PROMOTE_AT) {
      const was = current.id;
      archiveNemesis(game);
      game.nemesis = openDossier(game, top.id, top.friction, rng);
      logEvent(game, {
        type: 'nemesis',
        severity: 'critical',
        text: t('nemesis.replaced',
          '{next} displaces {prev} as the government’s central foreign problem.',
          { next: tNation(defOf(game, top.id)), prev: tNation(defOf(game, was)) }),
        nations: [top.id, was],
      });
      return { kind: 'replaced', id: top.id, previous: was };
    }
    return { kind: 'held', id: current.id };
  }

  if (top && top.friction >= PROMOTE_AT) {
    game.nemesis = openDossier(game, top.id, top.friction, rng);
    logEvent(game, {
      type: 'nemesis',
      severity: 'critical',
      text: t('nemesis.opened',
        'The file on {nation} is moved to the top of the desk. It is no longer one foreign relationship among fifty — it is the one.',
        { nation: tNation(defOf(game, top.id)) }),
      nations: [top.id],
    });
    return { kind: 'promoted', id: top.id };
  }

  return null;
}

function openDossier(game, id, friction, rng) {
  return {
    id,
    since: game.turn,
    friction,
    peak: friction,
    quarters: 0,
    // Which way the rivalry runs, for the wording. Whoever has done more of the
    // hitting owns the story.
    origin: originOf(game, id),
    codename: codenameFor(game, id, rng),
  };
}

/** Whether this became a rivalry because of what they did or what you did. */
function originOf(game, id) {
  const file = dossierOn(game, id);
  const theirs = file.filter((e) => e.by === 'them').reduce((s, e) => s + e.weight, 0);
  const yours = file.filter((e) => e.by === 'you').reduce((s, e) => s + e.weight, 0);
  if (theirs > yours * 1.3) return 'theirs';
  if (yours > theirs * 1.3) return 'yours';
  return 'mutual';
}

/**
 * Governments give their central problem a file name. It is cosmetic, and it is
 * the thing a player will still remember about the run in a month.
 */
const CODENAMES = [
  'the Long Winter', 'the Standing Question', 'the Northern File', 'the Open Wound',
  'the Quiet War', 'the Second Front', 'the Permanent Crisis', 'the Old Argument',
  'the Unfinished Business', 'the Cold Corridor', 'the Twenty-Year Problem', 'the Reckoning',
];

function codenameFor(game, id, rng) {
  const used = new Set(Object.values(game.pastNemeses || {}).map((n) => n.codename));
  const options = CODENAMES.filter((c) => !used.has(c));
  const pool = options.length ? options : CODENAMES;
  return rng ? rng.pick(pool) : pool[0];
}

/**
 * How much more likely this country is to point its quarter at you.
 *
 * Fed into the opponents' target weighting. A nemesis does not merely dislike
 * you — it has decided you are the problem, and spends its turns accordingly.
 */
export function targetingBias(game, actorId, targetId) {
  if (targetId !== game.playerId) return 1;
  const dossier = nemesisOf(game);
  if (!dossier || dossier.id !== actorId) return 1;
  // Scales with how hot it is, capped so a rivalry is a strong lean rather than
  // an obsession that ignores an invasion from the other direction.
  return clamp(1.9 + dossier.friction * 0.28, 1.9, 3.4);
}

/** Whether the rivalry has run hot enough for long enough to turn into a war. */
export function rivalryWarBias(game, actorId) {
  const dossier = nemesisOf(game);
  if (!dossier || dossier.id !== actorId) return 1;
  return clamp(1.3 + Math.min(1.2, dossier.quarters / 16), 1.3, 2.5);
}

/**
 * Everything the interface needs to render the rivalry, including the specific
 * orders it is built from.
 */
export function nemesisReport(game) {
  const dossier = nemesisOf(game);
  if (!dossier) return null;
  const def = defOf(game, dossier.id);
  const file = dossierOn(game, dossier.id);
  const atWar = game.wars.some(
    (w) => w.active &&
      ((w.attackers.includes(dossier.id) && w.defenders.includes(game.playerId)) ||
       (w.defenders.includes(dossier.id) && w.attackers.includes(game.playerId))),
  );
  return {
    ...dossier,
    def,
    atWar,
    relation: getRelation(game, game.playerId, dossier.id),
    ladder: ladderLevel(game, game.playerId, dossier.id),
    balance: combatPower(game, dossier.id) / Math.max(1, combatPower(game, game.playerId)),
    theirs: file.filter((e) => e.by === 'them').slice(0, 6),
    yours: file.filter((e) => e.by === 'you').slice(0, 6),
  };
}

/** Retire a rivalry into the run's history, so the closing page can name it. */
export function archiveNemesis(game) {
  const dossier = nemesisOf(game);
  if (!dossier) return;
  if (!game.pastNemeses) game.pastNemeses = {};
  game.pastNemeses[dossier.id] = {
    id: dossier.id,
    codename: dossier.codename,
    since: dossier.since,
    until: game.turn,
    peak: dossier.peak,
    origin: dossier.origin,
  };
}
