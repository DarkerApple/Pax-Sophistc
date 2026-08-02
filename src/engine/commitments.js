// Things you cannot simply stop doing.
//
// Every order until now was a payment: it cost what it cost, once, and the
// consequences were statistical. A commitment is different — it takes a slice
// of the budget for years, and breaking it costs more than finishing it. That
// asymmetry is what makes a plan a plan, and what makes people restart a run
// having decided differently.
//
// Two kinds:
//   · budget commitments — a programme that draws money every quarter until it
//     finishes, and a break fee if you cancel it early
//   · treaty commitments — a bloc you cannot walk out of this year without
//     paying for it in standing and in relations
//
// Both are visible from the quarter they are signed, with their end date and
// their exit price, so nothing here is a trap.

import { BLOCS } from '../data/nations.js';
import { clamp, defOf, logEvent, sovereignIds, blocsOf, adjustRelation } from './state.js';
import { t, tNation } from '../i18n/index.js';

/**
 * Which orders sign the country up to something rather than paying for it.
 *
 * `share` is the fraction of the order's own cost that recurs each quarter;
 * `turns` is how long; `breakFee` is a multiple of what remains.
 */
export const COMMITTING = {
  'blue-water-navy': { turns: 12, share: 0.35, breakFee: 0.5, label: 'Fleet programme' },
  'nuclear-power': { turns: 14, share: 0.3, breakFee: 0.6, label: 'Reactor programme' },
  'fusion-programme': { turns: 16, share: 0.3, breakFee: 0.45, label: 'Fusion programme' },
  'national-ai-programme': { turns: 10, share: 0.3, breakFee: 0.4, label: 'AI programme' },
  'rail-corridor': { turns: 12, share: 0.32, breakFee: 0.55, label: 'Corridor construction' },
  'healthcare-programme': { turns: 16, share: 0.4, breakFee: 0.8, label: 'Health coverage' },
  'housing-programme': { turns: 10, share: 0.35, breakFee: 0.45, label: 'Housing programme' },
  'grid-modernisation': { turns: 10, share: 0.28, breakFee: 0.4, label: 'Grid works' },
  'satellite-constellation': { turns: 10, share: 0.3, breakFee: 0.5, label: 'Constellation launches' },
  'munitions-industry': { turns: 10, share: 0.3, breakFee: 0.35, label: 'Munitions lines' },
  'air-defence-network': { turns: 10, share: 0.3, breakFee: 0.4, label: 'Air defence build' },
  'education-reform': { turns: 14, share: 0.35, breakFee: 0.6, label: 'Schools programme' },
  'water-programme': { turns: 12, share: 0.3, breakFee: 0.5, label: 'Water programme' },
  'development-bank': { turns: 14, share: 0.3, breakFee: 0.7, label: 'Development bank' },
  'base-network': { turns: 12, share: 0.3, breakFee: 0.65, label: 'Overseas basing' },
  'occupation-government': { turns: 10, share: 0.4, breakFee: 0.3, label: 'Occupation administration' },
};

/** How long a bloc holds you after you accede, before withdrawal is cheap. */
const TREATY_LOCK = 12;

export function commitmentsOf(game) {
  if (!game.commitments) game.commitments = [];
  return game.commitments;
}

/** Sign the country up, if this order is one that commits it. */
export function open(game, action, cost) {
  const spec = COMMITTING[action.id];
  if (!spec) return null;
  const commitments = commitmentsOf(game);
  // Doubling down on a programme extends it rather than running two.
  const existing = commitments.find((c) => c.actionId === action.id && !c.closed);
  if (existing) {
    existing.turnsLeft = Math.max(existing.turnsLeft, spec.turns);
    existing.quarterly = Math.max(existing.quarterly, Math.round(cost * spec.share));
    return existing;
  }

  const commitment = {
    id: `${action.id}-${game.turn}`,
    actionId: action.id,
    label: spec.label,
    quarterly: Math.round(cost * spec.share),
    turnsLeft: spec.turns,
    totalTurns: spec.turns,
    breakFee: spec.breakFee,
    openedTurn: game.turn,
    closed: false,
  };
  commitments.push(commitment);
  logEvent(game, {
    type: 'commitment',
    severity: 'info',
    text: t('commitment.opened',
      '{label}: ${n}B a quarter for {turns} quarters. Cancelling early costs more than finishing.',
      { label: spec.label, n: commitment.quarterly.toLocaleString(), turns: spec.turns }),
    nations: [game.playerId],
  });
  return commitment;
}

/**
 * Draw the quarter's instalments. Called from the economy tick, before the
 * treasury is reported, so the money is gone whether or not you looked.
 *
 * @returns {{paid: number, finished: Array}}
 */
export function tickCommitments(game) {
  const commitments = commitmentsOf(game);
  const state = game.nations[game.playerId];
  let paid = 0;
  const finished = [];

  for (const commitment of commitments) {
    if (commitment.closed) continue;
    state.treasury -= commitment.quarterly;
    paid += commitment.quarterly;
    commitment.turnsLeft -= 1;
    if (commitment.turnsLeft <= 0) {
      commitment.closed = true;
      commitment.completed = true;
      finished.push(commitment);
      logEvent(game, {
        type: 'commitment',
        severity: 'info',
        text: t('commitment.finished', '{label} is finished, and the budget line closes with it.',
          { label: commitment.label }),
        nations: [game.playerId],
      });
    }
  }

  // Nothing is retained forever; closed lines drop off after a few years so the
  // save does not accumulate a decade of dead entries.
  game.commitments = commitments.filter((c) => !c.closed || game.turn - c.openedTurn < 24);
  return { paid, finished };
}

/** What it would cost to walk away from a budget commitment right now. */
export function breakCost(commitment) {
  return Math.round(commitment.quarterly * commitment.turnsLeft * commitment.breakFee);
}

/**
 * Cancel a programme. The fee is charged immediately and the faction that
 * wanted it takes it personally — cancellation is the loudest thing a
 * government does.
 */
export function cancel(game, commitmentId) {
  const commitment = commitmentsOf(game).find((c) => c.id === commitmentId && !c.closed);
  if (!commitment) return { ok: false, reason: 'Nothing to cancel.' };
  const fee = breakCost(commitment);
  const state = game.nations[game.playerId];
  state.treasury -= fee;
  state.approval = clamp(state.approval - 4);
  state.stability = clamp(state.stability - 3);
  commitment.closed = true;
  commitment.cancelled = true;
  commitment.cancelledTurn = game.turn;

  logEvent(game, {
    type: 'commitment',
    severity: 'major',
    text: t('commitment.cancelled',
      '{label} is cancelled with {turns} quarters still to run. The break fee is ${n}B, and the contractors are already briefing against you.',
      { label: commitment.label, turns: commitment.turnsLeft, n: fee.toLocaleString() }),
    nations: [game.playerId],
  });
  return { ok: true, fee, commitment };
}

/** The quarter's total standing charge, for the books panel. */
export function committedSpend(game) {
  return commitmentsOf(game)
    .filter((c) => !c.closed)
    .reduce((sum, c) => sum + c.quarterly, 0);
}

// ── Treaties ────────────────────────────────────────────────────────────────

/** Record the date you joined, so leaving can have a price. */
export function noteAccession(game, blocId) {
  if (!game.treatyLocks) game.treatyLocks = {};
  game.treatyLocks[blocId] = game.turn;
}

/** What walking out of this bloc would cost you today. */
export function exitCost(game, blocId) {
  const bloc = BLOCS[blocId];
  if (!bloc) return null;
  const joined = game.treatyLocks?.[blocId];
  const founding = joined === undefined;
  const held = founding ? TREATY_LOCK : game.turn - joined;
  const locked = Math.max(0, TREATY_LOCK - held);

  const members = sovereignIds(game).filter(
    (id) => id !== game.playerId && blocsOf(game, id).includes(blocId),
  );

  return {
    blocId,
    locked,
    // Early exit is the expensive one: you are breaking something you asked for.
    influence: Math.round(bloc.cohesion / 10 + locked * 0.8),
    relation: -Math.round(bloc.cohesion / 3 + locked * 1.5),
    members: members.length,
    founding,
  };
}

/**
 * Charge the exit. Called after a withdrawal resolves, so the diplomatic wash
 * realign() applies is on top of a price that scales with how recently you
 * asked to be let in.
 */
export function chargeExit(game, blocId) {
  const cost = exitCost(game, blocId);
  if (!cost) return null;
  const state = game.nations[game.playerId];
  state.influence = clamp(state.influence - cost.influence);
  for (const id of sovereignIds(game)) {
    if (id === game.playerId) continue;
    if (!blocsOf(game, id).includes(blocId)) continue;
    adjustRelation(game, game.playerId, id, cost.relation);
  }
  if (game.treatyLocks) delete game.treatyLocks[blocId];

  if (cost.locked > 0) {
    logEvent(game, {
      type: 'commitment',
      severity: 'major',
      text: t('commitment.earlyExit',
        '{nation} walks out of {bloc} with {n} quarters still to run on its accession. The other members do not treat it as a technicality.',
        {
          nation: tNation(defOf(game, game.playerId)),
          bloc: t(`bloc.${blocId}`, BLOCS[blocId].name),
          n: cost.locked,
        }),
      nations: [game.playerId],
    });
  }
  return cost;
}
