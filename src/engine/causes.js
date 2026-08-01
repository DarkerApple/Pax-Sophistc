// Why it happened.
//
// An event that just lands is noise; an event with a cause is a consequence.
// Every cause here is scored against live state, so the explanation the game
// gives is one that is actually true of your country this quarter — a grid
// failure in a country under sanctions blames spare parts, the same failure in
// a rich one blames a deferred maintenance backlog.
//
// Causes are ids so they can be translated; the English sentence is the
// fallback, exactly as everywhere else in the game.

import { NATIONS_BY_ID } from '../data/nations.js';
import { activeWarsFor, getRelation } from './state.js';

/**
 * Each entry: an id, the domains it can explain, the English sentence, and a
 * score against live state. A score of 0 means "this is not true here".
 */
const CAUSES = [
  // ── Money ────────────────────────────────────────────────────────────────
  {
    id: 'austerity',
    domains: ['unrest', 'political', 'strike'],
    text: 'a budget that cut transfers before it cut anything else',
    score: (g, s) => (s.treasury < 0 ? 2.4 : s.treasury < s.gdp * 20 ? 1.1 : 0.2),
  },
  {
    id: 'inflation',
    domains: ['unrest', 'economic', 'strike'],
    text: 'prices that have outrun wages for four quarters running',
    score: (g, s) => (s.gdp > 0 && s.unrest > 35 ? 1.6 : 0.5),
  },
  {
    id: 'debtStress',
    domains: ['economic', 'political', 'unrest'],
    text: 'a debt load that now costs more to service than to have borrowed',
    score: (g, s) => (s.treasury < 0 ? 2.8 : 0.1),
  },
  {
    id: 'unemployment',
    domains: ['unrest', 'economic', 'strike'],
    text: 'a youth unemployment rate nobody in government will say out loud',
    score: (g, s) => (s.baseGrowth < 0.6 ? 1.8 : 0.6),
  },
  {
    id: 'commodityCrash',
    domains: ['economic', 'political'],
    text: 'an export price that fell through the floor of every budget assumption',
    score: (g, s, def) =>
      (def.tags || []).some((tg) => /export|producer|opec|oil|gas|lng/.test(tg)) ? 2.2 : 0.2,
  },

  // ── Politics ─────────────────────────────────────────────────────────────
  {
    id: 'scandal',
    domains: ['political', 'unrest', 'coup'],
    text: 'a procurement scandal that reached further into the cabinet than anyone expected',
    score: (g, s) => (s.approval < 45 ? 1.9 : 0.7),
  },
  {
    id: 'repression',
    domains: ['unrest', 'coup', 'separatist'],
    text: 'a crackdown that turned a protest movement into an opposition',
    score: (g, s, def) => (def.government?.includes('One-party') || s.stability < 45 ? 2.0 : 0.4),
  },
  {
    id: 'succession',
    domains: ['coup', 'political'],
    text: 'a succession nobody agreed on and everybody has a candidate for',
    score: (g, s) => (s.stability < 50 ? 1.9 : 0.5),
  },
  {
    id: 'purge',
    domains: ['coup', 'political', 'military'],
    text: 'an officer purge that removed the loyalists along with the plotters',
    score: (g, s) => (s.stability < 55 && s.military > 40 ? 1.7 : 0.3),
  },
  {
    id: 'election',
    domains: ['political', 'unrest'],
    text: 'a result half the country refuses to accept',
    score: (g, s, def) => (def.government?.match(/democracy|republic/i) ? 1.6 : 0.2),
  },

  // ── War and the border ───────────────────────────────────────────────────
  {
    id: 'warStrain',
    domains: ['unrest', 'coup', 'economic', 'strike', 'military'],
    text: 'a war that has now lasted longer than the government promised it would',
    score: (g, s) => (activeWarsFor(g, s.id).length ? 3.0 : 0),
  },
  {
    id: 'mobilisation',
    domains: ['unrest', 'coup', 'separatist'],
    text: 'a mobilisation order that reached the wrong provinces first',
    score: (g, s) => (activeWarsFor(g, s.id).length && s.readiness > 60 ? 2.2 : 0),
  },
  {
    id: 'defeat',
    domains: ['coup', 'political', 'military'],
    text: 'a defeat at the front that the army blames on the palace',
    score: (g, s) => {
      const war = activeWarsFor(g, s.id)[0];
      if (!war) return 0;
      const losing = war.attackers.includes(s.id) ? war.warScore < -20 : war.warScore > 20;
      return losing ? 3.2 : 0;
    },
  },
  {
    id: 'occupation',
    domains: ['separatist', 'unrest'],
    text: 'a province that has spent two years being governed by somebody else',
    score: (g, s) => (g.wars.some((w) => w.active && w.occupied?.some(([, from]) => from === s.id)) ? 2.6 : 0),
  },
  {
    id: 'hostileNeighbour',
    domains: ['separatist', 'political', 'military'],
    text: 'a neighbour with an interest in this exact outcome, and the means to fund it',
    score: (g, s) => {
      const def = NATIONS_BY_ID[s.id];
      if (!def) return 0;
      const enemies = Object.keys(g.nations).filter(
        (id) => id !== s.id && getRelation(g, s.id, id) <= -45,
      );
      return enemies.length ? 1.4 + Math.min(1.2, enemies.length * 0.2) : 0;
    },
  },

  // ── Society ──────────────────────────────────────────────────────────────
  {
    id: 'foodPrices',
    domains: ['unrest', 'riot', 'epidemic'],
    text: 'a staple price that doubled while the subsidy was being reviewed',
    score: (g, s) => (s.gdp / Math.max(s.population, 1) < 0.02 ? 2.4 : 0.8),
  },
  {
    id: 'displacement',
    domains: ['unrest', 'riot', 'epidemic'],
    text: 'camps that were meant to be temporary and are now in their third year',
    score: (g) => (g.wars.filter((w) => w.active).length ? 2.0 : 0.4),
  },
  {
    id: 'ethnicTension',
    domains: ['riot', 'separatist', 'unrest'],
    text: 'a grievance older than the border it sits on',
    score: (g, s) => (s.unrest > 45 ? 1.8 : 0.6),
  },
  {
    id: 'urbanCrowding',
    domains: ['riot', 'epidemic', 'disaster'],
    text: 'a city that has grown faster than anything built to serve it',
    score: (g, s) => (s.population > 60 ? 1.9 : 0.5),
  },
  {
    id: 'policeKilling',
    domains: ['riot'],
    text: 'a death in custody, filmed, and online before the statement was written',
    score: (g, s) => (s.unrest > 40 ? 2.2 : 0.9),
  },

  // ── Infrastructure ───────────────────────────────────────────────────────
  {
    id: 'deferredMaintenance',
    domains: ['accident', 'disaster'],
    text: 'a maintenance backlog that three budgets in a row decided could wait',
    score: (g, s) => (s.treasury < s.gdp * 30 ? 2.3 : 1.0),
  },
  {
    id: 'sanctionsParts',
    domains: ['accident', 'economic'],
    text: 'sanctioned spare parts and a workaround somebody signed off on anyway',
    score: (g, s) => (s.sanctionedBy?.length ? 3.0 : 0),
  },
  {
    id: 'gridStrain',
    domains: ['accident', 'disaster'],
    text: 'a grid running past its design load through a record summer',
    score: (g, s) => (s.tech < 70 ? 1.8 : 1.1),
  },
  {
    id: 'sabotage',
    domains: ['accident', 'military'],
    text: 'a failure the engineers say was not an accident, and cannot yet prove was not',
    score: (g, s) => {
      const enemies = Object.keys(g.nations).filter(
        (id) => id !== s.id && getRelation(g, s.id, id) <= -55,
      );
      return enemies.length ? 1.5 : 0;
    },
  },
  {
    id: 'agedPlant',
    domains: ['accident'],
    text: 'a reactor twelve years past the retirement date its regulator kept extending',
    score: (g, s) => (s.tech > 45 ? 1.7 : 0.6),
  },

  // ── Nature and health ────────────────────────────────────────────────────
  {
    id: 'drought',
    domains: ['disaster', 'unrest', 'economic'],
    text: 'a third consecutive failed rainy season',
    score: (g, s, def) => ((def.tags || []).includes('climate-exposed') ? 2.6 : 1.0),
  },
  {
    id: 'seismic',
    domains: ['disaster'],
    text: 'a fault that everyone knew about and nobody built for',
    score: (g, s, def) => ((def.tags || []).includes('seismic') ? 3.0 : 1.2),
  },
  {
    id: 'storms',
    domains: ['disaster'],
    text: 'a storm season that arrived early and did not stop',
    score: (g, s, def) => ((def.tags || []).some((tg) => /delta|coast|climate/.test(tg)) ? 2.6 : 1.0),
  },
  {
    id: 'weakHealthSystem',
    domains: ['epidemic'],
    text: 'a health service that lost a third of its staff to emigration',
    score: (g, s) => (s.gdp / Math.max(s.population, 1) < 0.03 ? 2.6 : 0.8),
  },
  {
    id: 'crossBorder',
    domains: ['epidemic'],
    text: 'a border crossing that was never going to be closed in time',
    score: () => 1.4,
  },
  {
    id: 'zoonotic',
    domains: ['epidemic'],
    text: 'a livestock market, a spillover, and six weeks nobody was looking',
    score: () => 1.3,
  },
];

/**
 * The most plausible explanation for something happening to this country now.
 *
 * @param {object} game
 * @param {object} nationState
 * @param {string} domain  one of unrest|riot|coup|separatist|accident|disaster|epidemic|economic|political|military|strike
 * @param {import('./rng.js').Rng} rng
 * @returns {{id: string, text: string} | null}
 */
export function causeFor(game, nationState, domain, rng) {
  if (!nationState) return null;
  const def = NATIONS_BY_ID[nationState.id];
  if (!def) return null;

  const candidates = [];
  for (const cause of CAUSES) {
    if (!cause.domains.includes(domain)) continue;
    const weight = cause.score(game, nationState, def) || 0;
    if (weight > 0) candidates.push({ cause, weight });
  }
  if (!candidates.length) return null;

  // Weighted so the most fitting explanation usually wins, but not always —
  // two runs of the same country should not narrate identically.
  const picked = rng.weighted(candidates, (c) => c.weight);
  return { id: picked.cause.id, text: picked.cause.text };
}

/** Every cause id, for the translation test. */
export function causeIds() {
  return CAUSES.map((c) => c.id);
}
