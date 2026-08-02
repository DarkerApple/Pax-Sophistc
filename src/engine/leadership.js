// How much you can actually do in a quarter.
//
// The order limit was four, always, for everybody. A government with an
// eighty-per-cent approval rating, a working civil service, four contented
// factions and eight years of practice was allowed exactly as many decisions as
// one that had just survived a coup — which is not how any of this works.
//
// Leadership is the standing of the office rather than of the country: how much
// the public will follow, how well the machinery executes, whether your own
// coalition is with you, and how long you have been doing it. It buys slots on
// the desk, and losing it takes them away again.

import { clamp, defOf } from './state.js';
import { FACTION_IDS, factionsOf } from './factions.js';
import { t } from '../i18n/index.js';

/** The fewest and most orders a quarter can ever hold. */
export const MIN_SLOTS = 2;
export const MAX_SLOTS = 7;

/**
 * The office's authority, 0–100, and where it came from.
 *
 * Every component is something the player can see and move, so a slot lost is
 * a slot they can explain — the panel lists the same five lines this returns.
 *
 * @returns {{value: number, band: object, slots: number, components: Array}}
 */
export function leadership(game) {
  const state = game.nations[game.playerId];
  if (!state) return { value: 0, band: BANDS[BANDS.length - 1], slots: MIN_SLOTS, components: [] };

  const factions = factionsOf(game);
  const standing = FACTION_IDS.reduce((sum, id) => sum + (factions[id]?.mood ?? 50), 0) / FACTION_IDS.length;

  // Experience: quarters in office across every term, saturating. A decade
  // teaches you the building; a second decade teaches you rather less.
  const quarters = game.turn + (game.termHistory || []).reduce((sum, term) => sum + 0, 0);
  const experience = clamp(100 * (1 - Math.exp(-quarters / 26)));

  // A record of decisions taken and crises survived, which is not the same
  // thing as the country doing well.
  const record = clamp(
    40 + (game.stats?.crisesResolved || 0) * 4 + (game.stats?.warsWon || 0) * 6 - (game.stats?.nukesUsed || 0) * 25,
  );

  const components = [
    { id: 'consent', label: 'public consent', value: state.approval, weight: 0.28 },
    { id: 'machinery', label: 'the machinery of state', value: state.stability, weight: 0.26 },
    { id: 'coalition', label: 'your own coalition', value: standing, weight: 0.24 },
    { id: 'experience', label: 'time in the building', value: experience, weight: 0.12 },
    { id: 'record', label: 'the record', value: record, weight: 0.1 },
  ];

  let value = components.reduce((sum, c) => sum + c.value * c.weight, 0);
  // Unrest is the one thing that eats authority rather than merely failing to
  // supply it: a government fighting its own streets is not leading anybody.
  const drag = Math.max(0, state.unrest - 45) * 0.35;
  value = clamp(value - drag);

  return {
    value: Math.round(value),
    band: bandOf(value),
    slots: slotsFor(value, game),
    drag: Number(drag.toFixed(1)),
    components: components.map((c) => ({ ...c, value: Math.round(c.value) })),
  };
}

const BANDS = [
  { floor: 82, id: 'commanding', label: 'commanding' },
  { floor: 66, id: 'strong', label: 'strong' },
  { floor: 50, id: 'workable', label: 'workable' },
  { floor: 34, id: 'weak', label: 'weak' },
  { floor: 18, id: 'faltering', label: 'faltering' },
  { floor: 0, id: 'spent', label: 'spent' },
];

function bandOf(value) {
  return BANDS.find((b) => value >= b.floor) || BANDS[BANDS.length - 1];
}

/**
 * How many orders that authority is worth this quarter.
 *
 * Four is the middle, so the number a player already knows is what an ordinary
 * government gets. Difficulty shifts the whole ladder rather than the top of
 * it, which is what makes a hard run feel cramped from the first quarter.
 */
export function slotsFor(value, game) {
  const shift = Math.round((5 - (game.difficulty ?? 5)) / 3);
  const base =
    value >= 84 ? 6
      : value >= 68 ? 5
        : value >= 44 ? 4
          : value >= 26 ? 3
            : 2;
  return clamp(base + shift, MIN_SLOTS, MAX_SLOTS);
}

/** The number the rest of the engine and the interface both ask for. */
export function orderSlots(game) {
  return leadership(game).slots;
}

/** What would have to change to earn the next slot, in one sentence. */
export function nextSlotAt(game) {
  const now = leadership(game);
  for (const threshold of [26, 44, 68, 84]) {
    if (now.value < threshold) {
      return {
        at: threshold,
        gap: threshold - now.value,
        // The cheapest lever, named. Approval moves fastest, so it is usually it.
        lever: now.components.slice().sort((a, b) => a.value - b.value)[0],
      };
    }
  }
  return null;
}

/**
 * Whether this order can go on the desk alongside what is already queued.
 *
 * You could previously queue the same order four times, which was never a
 * strategy — it was an oversight that let a player stack one modifier and skip
 * the rest of the catalogue. Repeating an order against a *different* country
 * is a real plan and stays allowed.
 *
 * @returns {{ok: boolean, reason: string|null}}
 */
export function canQueue(game, queued, action, targetId = null) {
  const slots = orderSlots(game);
  if (queued.length >= slots) {
    return {
      ok: false,
      reason: t('orders.slotsFull', '{n} orders is what this government can carry in a quarter.', { n: slots }),
    };
  }

  const clash = queued.find(
    (order) => order.actionId === action.id && (order.targetId || null) === (targetId || null),
  );
  if (clash) {
    return {
      ok: false,
      reason: targetId
        ? t('orders.alreadyAimed', 'That order is already queued against {nation}.', {
            nation: defOf(game, targetId)?.name || targetId,
          })
        : t('orders.alreadyQueued', 'Already queued. Doing the same thing twice in one quarter is not doing it twice as hard.'),
    };
  }

  // Two orders that both sign, both tear up or both end the same war are the
  // same order with different words on it.
  const exclusive = exclusionOf(action);
  if (exclusive) {
    const conflict = queued.find((order) => exclusionOf({ id: order.actionId, ...order.action }) === exclusive);
    if (conflict) {
      return {
        ok: false,
        reason: t('orders.conflicts', 'That conflicts with an order already on the desk.'),
      };
    }
  }

  return { ok: true, reason: null };
}

/** Groups of orders where issuing two in one quarter is incoherent. */
function exclusionOf(action) {
  if (!action) return null;
  if (action.alignment) return 'alignment';
  if (action.invokesTreaties) return 'invoke';
  if (action.renewsTreaties) return 'renew';
  if (action.warCommand === 'annex') return 'annex';
  return null;
}
