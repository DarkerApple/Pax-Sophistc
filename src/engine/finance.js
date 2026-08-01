// Public finance: borrowing, interest, and what happens when the bill arrives.
//
// A negative treasury used to block every order, which left a player with no
// legal move and no way back. Governments do not work like that — they borrow.
// So a deficit now buys you room at a price: interest every quarter, rising
// unrest, and a hard ceiling where the market stops lending and the adjustment
// is imposed on you instead.

import { clamp } from './state.js';

/** Quarterly interest charged on outstanding debt. */
const INTEREST_RATE = 0.022;

/**
 * How much a country can borrow beyond its cash, in billions.
 * Credible institutions borrow more, and more cheaply, than shaky ones.
 */
export function creditLimit(state) {
  const credibility = clamp(0.35 + state.stability / 130, 0.3, 1.15);
  return state.gdp * 1000 * 0.3 * credibility;
}

/** Cash plus borrowing headroom: what an order may actually be paid from. */
export function availableFunds(state) {
  return state.treasury + creditLimit(state);
}

export function debtOf(state) {
  return state.treasury < 0 ? -state.treasury : 0;
}

/** 0 when solvent, 1 when the credit line is exhausted. */
export function debtStress(state) {
  const limit = creditLimit(state);
  return limit <= 0 ? 1 : clamp(debtOf(state) / limit, 0, 1);
}

/**
 * Charge interest and apply the political cost of running a deficit.
 * @returns {object|null} a report entry when the debt is doing something
 */
export function serviceDebt(game, state, rng, mods) {
  const debt = debtOf(state);
  if (debt <= 0) return null;

  const limit = creditLimit(state);
  const stress = debtStress(state);

  // Interest compounds on the outstanding balance.
  const interest = debt * INTEREST_RATE * (1 + stress * 0.8);
  state.treasury -= interest;

  // Carrying debt is politically expensive well before it is fatal.
  state.unrest = clamp(state.unrest + stress * 2.2 * mods.unrestMultiplier);
  state.approval = clamp(state.approval - stress * 1.6);

  let forced = null;
  if (state.treasury < -limit) {
    // The market has stopped lending. The adjustment happens whether the
    // government wants it or not.
    const shortfall = -state.treasury - limit;
    // The programme comes with new money as well as conditions, so the
    // government always walks out of it with room to act. Without this the
    // credit line pins at zero and there is no legal move left.
    state.treasury = -limit * 0.75;
    state.unrest = clamp(state.unrest + 6 * mods.unrestMultiplier);
    state.stability = clamp(state.stability - 4);
    state.approval = clamp(state.approval - 6);
    state.modifiers.push({
      id: `imf-${game.turn}-${state.id}`,
      label: 'Emergency adjustment programme',
      turnsLeft: 5,
      growth: -0.4,
      stability: 0,
      unrest: 0.8,
      influence: 0,
      readiness: 0,
      tech: 0,
      revenue: 0,
      source: 'debt',
    });
    forced = { shortfall: Math.round(shortfall) };
  }

  return {
    debt: Math.round(debt),
    limit: Math.round(limit),
    interest: Math.round(interest),
    stress: Number(stress.toFixed(2)),
    forced,
  };
}

/** Plain-language read on the public finances, for the UI and the briefing. */
export function describeFinances(state) {
  const debt = debtOf(state);
  if (!debt) {
    return { band: 'solvent', label: 'In surplus', detail: 'No outstanding debt.' };
  }
  const stress = debtStress(state);
  if (stress >= 0.95) return { band: 'crisis', label: 'Credit exhausted', detail: 'Lenders have stopped rolling the debt over.' };
  if (stress >= 0.7) return { band: 'strained', label: 'Heavily indebted', detail: 'Servicing costs are crowding out everything else.' };
  if (stress >= 0.35) return { band: 'borrowing', label: 'Borrowing', detail: 'Manageable, but the interest is real.' };
  return { band: 'light', label: 'Light borrowing', detail: 'Comfortably within the credit line.' };
}
