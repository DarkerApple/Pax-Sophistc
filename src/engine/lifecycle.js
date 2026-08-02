// Terms: opening one, closing one, and standing again.
//
// A run used to be a term, and a term used to be the whole save. The country is
// now the save. A term is a chapter of it: you take office, you are given a
// mandate and four factions and a constitution you did not write, you govern,
// and at the end the country decides whether it wants you for another one.
//
// What carries across a term boundary is everything that would carry in life —
// the debts, the half-built programmes, the treaties, the borders, the rivalry,
// the constitution you amended — and what resets is the brief you are judged
// against and some of the patience your creditors have for you.
//
// This module sits above state.js so the subsystems that need a complete game
// (factions, constitution, mandate, ambitions) can be initialised in one place
// without state.js having to import all of them.

import { Rng } from './rng.js';
import { createGame, defOf, clamp, logEvent, withRng, sovereignIds } from './state.js';
import { createFactions } from './factions.js';
import { foundingConstitution, electionOutlook, mayStandAgain, constitutionOf } from './constitution.js';
import { foundingMandate, mandateForNewTerm } from './mandate.js';
import { dealAmbitions } from './ambitions.js';
import { archiveNemesis } from './nemesis.js';
import { t, tNation } from '../i18n/index.js';

/** How long one term runs, in quarters, unless the caller says otherwise. */
export const TERM_LENGTH = 40;

/**
 * Create a world and open the first term on it.
 *
 * The entry point for anything starting a new run. `createGame` still works on
 * its own — everything below is idempotent and lazily applied — but going
 * through here means the mandate, the factions and the constitution exist
 * before the first render rather than after the first quarter.
 */
export function startGame(options = {}) {
  const game = createGame(options);
  ensureTerm(game);
  return game;
}

/**
 * Make sure the term-scoped subsystems exist on this game.
 *
 * Called from advanceTurn, from the scorer and from the interface, so a save
 * written before any of this existed, or a game built with createGame directly,
 * comes up complete rather than half-initialised.
 */
export function ensureTerm(game) {
  if (!game || !game.nations?.[game.playerId]) return game;
  const def = defOf(game, game.playerId);

  if (!game.term) game.term = 1;
  if (!Array.isArray(game.termHistory)) game.termHistory = [];
  if (!game.objectives?.length) game.objectives = foundingMandate(def);
  if (!game.constitution) game.constitution = foundingConstitution(def);
  if (!game.factions) {
    game.factions = withRng(game, (rng) => createFactions(game, rng));
  }
  if (!game.ambitions || !Object.keys(game.ambitions).length) {
    game.ambitions = withRng(game, (rng) => dealAmbitions(game, rng));
  }
  if (!game.grievances) game.grievances = {};
  if (!game.intel) game.intel = {};
  if (!game.commitments) game.commitments = [];
  if (!game.treatyLocks) game.treatyLocks = {};
  if (!game.pastNemeses) game.pastNemeses = {};
  if (game.mandateReviewedAt === undefined) game.mandateReviewedAt = 0;
  return game;
}

// ── Standing again ──────────────────────────────────────────────────────────

/**
 * What the country would decide if the vote were held now.
 *
 * Exposed so the interface can show it from the moment the term's last year
 * begins — an election you can see coming is a term you can govern toward.
 */
export function electionState(game, score) {
  ensureTerm(game);
  const allowed = mayStandAgain(game);
  const outlook = electionOutlook(game, score, game.factions);
  const constitution = constitutionOf(game);
  return {
    allowed,
    limit: constitution.termLimit,
    term: game.term || 1,
    ...outlook,
    // Why you cannot stand, if you cannot — the clause, by name, so the player
    // knows exactly which amendment would have changed it.
    barredBy: allowed ? null : 'termLimit',
  };
}

/**
 * Close the term and, if the country will have you, open the next one.
 *
 * @param {object} game
 * @param {object} score the closing score, used by the electorate
 * @param {{stand: boolean}} intent whether the incumbent is standing again
 * @returns {{outcome: 'stood-down'|'barred'|'defeated'|'re-elected', election: object}}
 */
export function concludeTerm(game, score, { stand = true } = {}) {
  ensureTerm(game);
  const election = electionState(game, score);
  const player = game.nations[game.playerId];

  // The term goes into the record whatever happens next.
  game.termHistory.push({
    term: game.term || 1,
    endedTurn: game.turn,
    endedYear: game.year,
    grade: score?.grade ?? null,
    total: score?.total ?? null,
    gdp: Number(player.gdp.toFixed(3)),
    approval: Math.round(player.approval),
    share: election.share,
  });

  if (!stand) {
    return { outcome: 'stood-down', election };
  }
  if (!election.allowed) {
    return { outcome: 'barred', election };
  }
  if (!election.won) {
    return { outcome: 'defeated', election };
  }

  openTerm(game, { election, score });
  return { outcome: 're-elected', election };
}

/**
 * Begin a new term on an existing country.
 *
 * Everything structural survives. What resets is the clock, the brief, and part
 * of the patience of the four factions — a re-elected government starts with
 * some of the goodwill it earned and none of the honeymoon it had the first
 * time.
 */
export function openTerm(game, { election = null, score = null } = {}) {
  ensureTerm(game);
  const def = defOf(game, game.playerId);
  const player = game.nations[game.playerId];

  archiveNemesis(game);

  game.term = (game.term || 1) + 1;
  game.totalTurns = game.turn + TERM_LENGTH;
  game.status = 'active';
  game.ending = null;
  game.congress = null;
  game.mandateReviewedAt = game.turn;

  // A fresh brief, plus whatever the outgoing term left unfinished.
  game.objectives = mandateForNewTerm(game, def);

  // The factions carry their standing across, damped toward indifference: a
  // mandate buys you the benefit of the doubt, not a clean sheet.
  game.factions = withRng(game, (rng) =>
    createFactions(game, rng, { carryOver: game.factions }));

  // Winning is worth something at home, and the size of the win is worth more.
  const margin = election ? clamp((election.share - 50) / 3, -8, 14) : 4;
  player.approval = clamp(player.approval + margin);
  player.stability = clamp(player.stability + margin * 0.4);
  player.unrest = clamp(player.unrest - margin * 0.3);

  logEvent(game, {
    type: 'term',
    severity: 'critical',
    text: election
      ? t('term.reelected',
          '{nation} returns the government for a {ordinal} term on {pct}% of the vote. The debts, the treaties and the half-built programmes come with it.',
          { nation: tNation(def), ordinal: ordinal(game.term), pct: election.share.toFixed(0) })
      : t('term.opened', 'A new term opens.', {}),
    nations: [game.playerId],
  });

  return game;
}

function ordinal(n) {
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** What the incumbent inherits from themselves, for the hand-off screen. */
export function inheritance(game) {
  ensureTerm(game);
  const player = game.nations[game.playerId];
  const running = (game.commitments || []).filter((c) => !c.closed);
  return {
    debt: player.treasury < 0 ? Math.round(-player.treasury) : 0,
    commitments: running.map((c) => ({
      label: c.label,
      quarterly: c.quarterly,
      turnsLeft: c.turnsLeft,
    })),
    committedQuarterly: running.reduce((sum, c) => sum + c.quarterly, 0),
    modifiers: player.modifiers.filter((m) => m.turnsLeft > 4).length,
    wars: game.wars.filter(
      (w) => w.active && (w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId)),
    ).length,
    nemesis: game.nemesis?.id || null,
    amendments: (game.constitution?.amendments || []).length,
    blocs: (game.blocMembership?.[game.playerId] || []).length,
  };
}

/**
 * Seed a fresh world from the one this run is leaving behind.
 *
 * The era registry already treats a world as a data pack; this turns the state
 * a run ends in into the starting sheet for the next one, so a campaign is the
 * same engine run twice with the second world written by the first.
 *
 * @returns {Array<object>} a roster, ready to hand to registerScenario
 */
export function rosterFromWorld(game) {
  ensureTerm(game);
  return sovereignIds(game).map((id) => {
    const def = defOf(game, id);
    const state = game.nations[id];
    return {
      ...def,
      gdp: Number(state.gdp.toFixed(3)),
      population: Number(state.population.toFixed(1)),
      military: Math.round(state.military),
      readiness: Math.round(state.readiness),
      tech: Math.round(state.tech),
      stability: Math.round(state.stability),
      influence: Math.round(state.influence),
      unrest: Math.round(state.unrest),
      nukes: Math.round(state.nukes),
      growth: Number((state.baseGrowth ?? def.growth).toFixed(2)),
      blocs: [...(game.blocMembership?.[id] || def.blocs || [])],
      // Where it came from, so the next era's briefings can say so.
      inheritedFrom: { seed: game.seed, year: game.year, id },
    };
  });
}
