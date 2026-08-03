// Asking somebody who owes you nothing.
//
// There were three ways a country ended up in a war: it started one, it had
// signed something, or the balance-of-power machinery decided on its own that
// it could not sit this one out. All three happen *to* the player. None of them
// is the thing a government at war actually spends its days doing, which is
// getting on the telephone to the capitals that have not committed yet and
// making the case.
//
// A rally is that call. It is aimed at a named country with no obligation to
// you, and it is hard — the base rate is low and it is talked up by things the
// player can see and move: whether they share a border with the enemy, whether
// they are frightened of it, whether they can physically get to the theatre,
// whether they need your market, and whether you look like you are winning.
// People join wars they think are nearly over, on the side they think is going
// to win, and this arithmetic says so.
//
// Refusing costs the asker. A call that goes unanswered is a public fact about
// what your friendship is worth.

import { t, tNation } from '../i18n/index.js';
import {
  addModifier,
  adjustRelation,
  blocsOf,
  clamp,
  combatPower,
  defOf,
  getRelation,
  isSovereign,
  livePower,
  logEvent,
  sovereignIds,
} from './state.js';
import { adjacent, theatreOf, theatreWeight } from './reach.js';
import { exposure } from './dependency.js';
import { threatOf } from './coalitions.js';
import { alliesOf } from './treaties.js';

/** Nobody enters somebody else's war lightly. */
const BASE = 0.06;

/** How many can be talked round by one sweeping call. */
const SWEEP_CAP = 3;

/** Which side of this war the caller is on, and who they are fighting. */
function sidesFor(war, callerId) {
  const attacking = war.attackers.includes(callerId);
  return {
    side: attacking ? 'attackers' : 'defenders',
    enemies: attacking ? war.defenders : war.attackers,
    attacking,
  };
}

/**
 * The odds of one country answering one call, and everything that went into it.
 *
 * Every factor is named, because a refusal a player cannot explain is a refusal
 * they cannot do anything about next quarter.
 *
 * @returns {{chance: number, factors: Array<{id: string, label: string, value: number}>}}
 */
export function rallyOdds(game, callerId, targetId, war) {
  if (!war || !isSovereign(game, targetId)) return { chance: 0, factors: [] };
  const { enemies, attacking } = sidesFor(war, callerId);
  if (war.attackers.includes(targetId) || war.defenders.includes(targetId)) {
    return { chance: 0, factors: [] };
  }

  const theatre = theatreOf(game, war);
  const def = defOf(game, targetId);
  const state = game.nations[targetId];

  // How much of the enemy there is, relative to them.
  const risk = Math.max(...enemies.map((e) => combatPower(game, e)))
    / Math.max(1, combatPower(game, targetId));
  // Whether we look like we are winning, from their side of the table.
  const ourLead = attacking ? war.warScore : -war.warScore;

  const bordersEnemy = enemies.some((e) => adjacent(game, targetId, e));
  const bordersUs = adjacent(game, targetId, callerId);
  const paper = alliesOf(game, callerId).find((ally) => ally.id === targetId);
  const sharedBloc = blocsOf(game, targetId).some((b) => blocsOf(game, callerId).includes(b));
  const fear = Math.max(...enemies.map((e) => threatOf(game, e)));
  const theirHostility = -Math.min(0, ...enemies.map((e) => getRelation(game, targetId, e)));
  const alreadyFighting = game.wars.some(
    (w) => w.active && w.id !== war.id
      && (w.attackers.includes(targetId) || w.defenders.includes(targetId)),
  );
  const neutralist = (def?.tags || []).some((tg) => /neutral|non-aligned|multi-aligned|bamboo|nuclear-free/.test(tg))
    || (state?.neutralUntil ?? 0) > game.turn;

  const factors = [
    { id: 'relation', label: 'how they feel about you', value: getRelation(game, callerId, targetId) / 190 },
    { id: 'frontier', label: 'they share a border with the enemy', value: bordersEnemy ? 0.2 : 0 },
    { id: 'neighbour', label: 'they share a border with you', value: bordersUs ? 0.13 : 0 },
    { id: 'fear', label: 'how frightening the enemy has become', value: fear * 0.5 },
    { id: 'grievance', label: 'their own quarrel with the enemy', value: Math.min(0.24, theirHostility / 320) },
    { id: 'paper', label: 'what they have already signed with you', value: paper ? paper.weight * 0.055 : 0 },
    { id: 'bloc', label: 'an organisation you are both in', value: sharedBloc ? 0.1 : 0 },
    { id: 'commerce', label: 'how much they need your market', value: exposure(game, targetId, callerId) * 1.7 },
    // A country that could not get an army to the theatre has very little
    // reason to declare that it is sending one.
    { id: 'reach', label: 'whether they could even get there', value: (theatreWeight(game, targetId, war) - 0.5) * 0.34 },
    { id: 'momentum', label: 'whether you look like winning', value: Math.max(-0.22, Math.min(0.22, ourLead / 240)) },
    { id: 'aggressor', label: 'that you started it', value: attacking ? -0.16 : 0 },
    { id: 'risk', label: 'what it would cost them', value: -Math.min(0.3, Math.log2(Math.max(1, risk)) * 0.13) },
    { id: 'busy', label: 'they have a war of their own', value: alreadyFighting ? -0.2 : 0 },
    { id: 'neutral', label: 'a standing policy of staying out', value: neutralist ? -0.17 : 0 },
    { id: 'home', label: 'their own house', value: -Math.max(0, (state?.unrest ?? 0) - 50) / 220 },
  ];

  const chance = clamp(BASE + factors.reduce((sum, f) => sum + f.value, 0), 0.01, 0.92);
  return {
    chance: Number(chance.toFixed(2)),
    theatre,
    factors: factors
      .filter((f) => Math.abs(f.value) >= 0.02)
      .map((f) => ({ ...f, value: Number(f.value.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  };
}

/**
 * Everybody worth calling, best prospect first, each with the two reasons that
 * most explain the number. This is what the country menu and the war panel
 * read; nothing here changes anything.
 */
export function rallyCandidates(game, callerId, war, limit = 8) {
  if (!war?.active) return [];
  const inIt = new Set([...war.attackers, ...war.defenders]);
  const asked = war.rallied?.[callerId] || {};

  return sovereignIds(game)
    .filter((id) => id !== callerId && !inIt.has(id))
    .map((id) => {
      const odds = rallyOdds(game, callerId, id, war);
      return {
        id,
        def: defOf(game, id),
        chance: odds.chance,
        factors: odds.factors,
        for: odds.factors.filter((f) => f.value > 0).slice(0, 2),
        against: odds.factors.filter((f) => f.value < 0).slice(0, 1),
        power: livePower(game, id),
        weight: theatreWeight(game, id, war),
        askedTurn: asked[id] ?? null,
      };
    })
    .filter((entry) => entry.askedTurn === null || game.turn - entry.askedTurn >= COOLDOWN)
    .sort((a, b) => b.chance - a.chance || b.power - a.power)
    .slice(0, limit);
}

/** How long before a country that said no will take the call again. */
export const COOLDOWN = 4;

/** Has this country already been asked recently enough to matter? */
export function askedRecently(game, callerId, targetId, war) {
  const turn = war?.rallied?.[callerId]?.[targetId];
  return turn !== undefined && game.turn - turn < COOLDOWN;
}

/**
 * Make the call.
 *
 * @returns {{joined: boolean, chance: number, targetId: string, text: string}}
 */
export function rally(game, callerId, targetId, war, rng, { pressure = 1 } = {}) {
  if (!war?.active) return null;
  const { side, enemies } = sidesFor(war, callerId);
  if (war.attackers.includes(targetId) || war.defenders.includes(targetId)) return null;

  const { chance } = rallyOdds(game, callerId, targetId, war);
  if (!war.rallied) war.rallied = {};
  if (!war.rallied[callerId]) war.rallied[callerId] = {};
  war.rallied[callerId][targetId] = game.turn;

  const joined = rng.bool(clamp(chance * pressure, 0.01, 0.95));
  const caller = defOf(game, callerId);
  const them = defOf(game, targetId);

  if (joined) {
    war[side].push(targetId);
    for (const enemy of enemies) adjustRelation(game, targetId, enemy, -55);
    adjustRelation(game, callerId, targetId, 20);
    game.worldTension = clamp(game.worldTension + 6, 0, 100);
    // Sending an army somewhere is not free even when it goes well.
    addModifier(game, targetId, {
      label: 'Expeditionary commitment',
      turns: 8,
      growth: -0.22,
      unrest: 0.5,
      source: 'rally',
    });

    const text = t('rally.joined',
      '{them} enters {war} alongside {caller}. Nobody was obliged to anybody; the argument was simply made and it was accepted.',
      { them: tNation(them), war: war.name, caller: tNation(caller) });
    logEvent(game, { type: 'war', severity: 'critical', text, nations: [callerId, targetId] });
    return { joined: true, chance, targetId, text };
  }

  // A refusal is a public fact. It costs the asker a little standing and the
  // relationship a little warmth — which is why calling everybody at once is
  // not obviously the right move.
  adjustRelation(game, callerId, targetId, -6);
  const caller_ = game.nations[callerId];
  if (caller_) caller_.influence = clamp(caller_.influence - 1.5);

  const text = t('rally.refused',
    '{them} declines to enter {war}. The statement expresses concern and commits to nothing.',
    { them: tNation(them), war: war.name });
  logEvent(game, { type: 'war', severity: 'info', text, nations: [callerId, targetId] });
  return { joined: false, chance, targetId, text };
}

/**
 * One call to every capital that might take it.
 *
 * Cheaper per country than working the telephone one at a time, and worse: a
 * general appeal is easier to refuse than a direct request, and refusing in
 * company costs a country nothing.
 *
 * @returns {{joined: Array, refused: Array}}
 */
export function rallyAll(game, callerId, war, rng, { pressure = 0.5, cap = SWEEP_CAP } = {}) {
  const joined = [];
  const refused = [];
  for (const candidate of rallyCandidates(game, callerId, war, 12)) {
    if (joined.length >= cap) break;
    const answer = rally(game, callerId, candidate.id, war, rng, { pressure });
    if (!answer) continue;
    (answer.joined ? joined : refused).push(answer);
  }

  if (joined.length || refused.length) {
    logEvent(game, {
      type: 'war',
      severity: joined.length ? 'major' : 'info',
      text: joined.length
        ? t('rally.sweepAnswered', '{n} of {all} capitals answer the appeal: {list}.', {
            n: joined.length,
            all: joined.length + refused.length,
            list: joined.map((a) => tNation(defOf(game, a.targetId))).join(', '),
          })
        : t('rally.sweepUnanswered',
            'The appeal goes to {n} capitals and is answered by none of them. Everybody has read the same intelligence you have.',
            { n: refused.length }),
      nations: [callerId, ...joined.map((a) => a.targetId)],
    });
  }
  return { joined, refused };
}

/**
 * The AI does this too.
 *
 * Once a quarter, whichever side is losing badly enough to be desperate makes
 * one call. Without this the mechanism would be a thing only the player has,
 * and the world would be visibly playing a different game.
 */
export function aiRally(game, war, rng, mods) {
  if (!war.active || game.turn - war.startTurn < 2) return null;
  const losing = war.warScore > 12 ? 'defenders' : war.warScore < -12 ? 'attackers' : null;
  if (!losing) return null;

  const caller = war[losing].find((id) => id !== game.playerId && isSovereign(game, id));
  if (!caller) return null;
  if (!rng.bool(0.3 * Math.min(1.5, mods?.aiAggression ?? 1))) return null;

  const candidates = rallyCandidates(game, caller, war, 4);
  if (!candidates.length) return null;
  const pick = rng.weighted(candidates, (c) => Math.max(0.01, c.chance));
  const answer = rally(game, caller, pick.id, war, rng, { pressure: 0.8 });
  if (!answer?.joined) return null;

  return {
    type: 'rally',
    warId: war.id,
    title: t('rally.title', 'A Capital Answers'),
    text: answer.text,
    joinerId: answer.targetId,
    callerId: caller,
  };
}

// ── For the interface ───────────────────────────────────────────────────────

/**
 * The wars this country is fighting that it could plausibly call somebody into,
 * so the country menu can offer the ask without the player hunting for a war.
 */
export function ralliableWars(game, callerId = game.playerId) {
  return game.wars.filter(
    (war) => war.active && (war.attackers.includes(callerId) || war.defenders.includes(callerId)),
  );
}

/** Can we ask this particular country into any war we are fighting? */
export function canRally(game, targetId, callerId = game.playerId) {
  for (const war of ralliableWars(game, callerId)) {
    if (war.attackers.includes(targetId) || war.defenders.includes(targetId)) continue;
    if (askedRecently(game, callerId, targetId, war)) continue;
    return war;
  }
  return null;
}
