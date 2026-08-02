// What every government privately wanted.
//
// Dealt at setup, hidden for the whole run, revealed at the end. They are not
// scored for the AI — the AI does not need a secret to behave — but they give
// the closing page something to say about why the decade went the way it did,
// and they give the player's own run a second, private win condition that
// nobody was told about.
//
// The player's ambition is shown to the player from the start (it is theirs),
// and counts toward the final grade. Everyone else's is a reveal.

import { defOf, getRelation, isSovereign, livePower, sovereignIds, clamp } from './state.js';
import { areaOf, startingAreaOf } from './territory.js';
import { blocsOf } from './state.js';
import { t, tNation } from '../i18n/index.js';

/**
 * The ambitions a government can be dealt.
 *
 * Each carries the condition that puts it in the deck for a given country and
 * a test that can be run at the end. Everything is evaluated from the state, so
 * an ambition survives serialisation as an id and a couple of parameters.
 */
export const AMBITIONS = [
  {
    id: 'reunify',
    title: 'Reunification',
    detail: 'End the decade holding more ground than you were handed — the ground you believe was always yours.',
    fits: (game, id) => true,
    check: (game, id) => areaOf(game, id) >= startingAreaOf(game, id) * 1.08,
  },
  {
    id: 'outlast',
    title: 'Outlast them',
    detail: 'One rival must end the decade weaker than you, whatever else happens.',
    fits: (game, id) => rivalFor(game, id) !== null,
    seed: (game, id) => ({ rivalId: rivalFor(game, id) }),
    check: (game, id, params) =>
      !params.rivalId
      || !isSovereign(game, params.rivalId)
      || livePower(game, id) > livePower(game, params.rivalId),
    describe: (game, params) =>
      params.rivalId
        ? t('ambition.outlastOn', 'Finish stronger than {nation}.', { nation: tNation(defOf(game, params.rivalId)) })
        : null,
  },
  {
    id: 'never-fire',
    title: 'Not one shot',
    detail: 'Reach the end of the decade without your country ever having gone to war.',
    fits: () => true,
    check: (game, id) => !game.wars.some((w) => w.attackers.includes(id) || w.defenders.includes(id)),
  },
  {
    id: 'break-the-bloc',
    title: 'Break the bloc',
    detail: 'An organisation you were never let into must be smaller at the end than it is now.',
    fits: (game, id) => outsideBlocs(game, id).length > 0,
    seed: (game, id) => {
      const options = outsideBlocs(game, id);
      const target = options[0];
      return { blocId: target.id, baseline: target.members };
    },
    check: (game, id, params) => {
      if (!params.blocId) return false;
      const now = sovereignIds(game).filter((n) => blocsOf(game, n).includes(params.blocId)).length;
      return now < (params.baseline ?? 99);
    },
    describe: (game, params) =>
      params.blocId
        ? t('ambition.breakOn', 'See {bloc} smaller than it was.', { bloc: t(`bloc.${params.blocId}`, params.blocId) })
        : null,
  },
  {
    id: 'first-among',
    title: 'First among equals',
    detail: 'Finish the decade as the strongest power in your own region — no argument, no asterisk.',
    fits: () => true,
    check: (game, id) => {
      const def = defOf(game, id);
      const region = sovereignIds(game).filter((n) => defOf(game, n)?.region === def?.region);
      if (region.length < 2) return true;
      const best = region.reduce((a, b) => (livePower(game, a) >= livePower(game, b) ? a : b));
      return best === id;
    },
  },
  {
    id: 'friends-everywhere',
    title: 'No enemies left',
    detail: 'End with no country in the world holding you in open hostility.',
    fits: () => true,
    check: (game, id) => sovereignIds(game).every((n) => n === id || getRelation(game, id, n) > -40),
  },
  {
    id: 'the-quiet-decade',
    title: 'A quiet decade',
    detail: 'World tension must end lower than it began, and nobody may have used a weapon of the last resort.',
    fits: () => true,
    check: (game) => game.worldTension < 42 && game.stats.nukesUsed === 0,
  },
  {
    id: 'double-it',
    title: 'Double it',
    detail: 'The economy you were handed must be half the economy you leave.',
    fits: () => true,
    check: (game, id, params) => game.nations[id].gdp >= (params.baseline ?? 0) * 1.9,
    seed: (game, id) => ({ baseline: game.nations[id].gdp }),
  },
  {
    id: 'a-seat',
    title: 'A seat at the table',
    detail: 'Finish inside at least three organisations. Being in the room is the whole ambition.',
    fits: () => true,
    check: (game, id) => blocsOf(game, id).length >= 3,
  },
  {
    id: 'the-arsenal',
    title: 'The insurance policy',
    detail: 'Finish the decade holding weapons you did not have when it began.',
    fits: (game, id) => game.nations[id].nukes === 0,
    check: (game, id) => game.nations[id].nukes > 0,
  },
];

export const AMBITIONS_BY_ID = Object.fromEntries(AMBITIONS.map((a) => [a.id, a]));

function rivalFor(game, id) {
  const def = defOf(game, id);
  const options = sovereignIds(game)
    .filter((n) => n !== id)
    .map((n) => ({ n, score: -getRelation(game, id, n) + (defOf(game, n)?.region === def?.region ? 25 : 0) }))
    .sort((a, b) => b.score - a.score);
  return options.length && options[0].score > 10 ? options[0].n : null;
}

function outsideBlocs(game, id) {
  const mine = blocsOf(game, id);
  const counts = new Map();
  for (const other of sovereignIds(game)) {
    for (const bloc of blocsOf(game, other)) {
      counts.set(bloc, (counts.get(bloc) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([bloc]) => !mine.includes(bloc))
    .map(([id2, members]) => ({ id: id2, members }))
    .sort((a, b) => b.members - a.members);
}

/** Deal one ambition to every country. Called once, at world creation. */
export function dealAmbitions(game, rng) {
  const dealt = {};
  for (const id of sovereignIds(game)) {
    const options = AMBITIONS.filter((a) => a.fits(game, id));
    if (!options.length) continue;
    const ambition = rng.pick(options);
    dealt[id] = {
      id: ambition.id,
      params: ambition.seed ? ambition.seed(game, id) : {},
      dealtTurn: game.turn,
    };
  }
  return dealt;
}

export function ambitionOf(game, id) {
  const record = game.ambitions?.[id];
  if (!record) return null;
  const spec = AMBITIONS_BY_ID[record.id];
  if (!spec) return null;
  return {
    ...record,
    title: spec.title,
    detail: spec.describe?.(game, record.params) || spec.detail,
  };
}

/** Whether a country got what it privately wanted. */
export function achieved(game, id) {
  const record = game.ambitions?.[id];
  const spec = record && AMBITIONS_BY_ID[record.id];
  if (!spec) return false;
  try {
    return Boolean(spec.check(game, id, record.params || {}));
  } catch {
    return false;
  }
}

/**
 * Everyone's ambition and whether they got it, for the reveal. Ordered so the
 * player is first and the countries that mattered to the run come next.
 */
export function revealAmbitions(game, { limit = 10 } = {}) {
  const ids = Object.keys(game.ambitions || {}).filter((id) => game.nations[id]);
  const scored = ids.map((id) => ({
    id,
    def: defOf(game, id),
    ambition: ambitionOf(game, id),
    achieved: achieved(game, id),
    sovereign: isSovereign(game, id),
    weight:
      (id === game.playerId ? 1e6 : 0) +
      (game.nemesis?.id === id ? 1e5 : 0) +
      livePower(game, id),
  }));
  return scored
    .filter((entry) => entry.ambition)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/** The player's own ambition contributes to the final grade. */
export function ambitionBonus(game) {
  if (!game.ambitions?.[game.playerId]) return 0;
  return achieved(game, game.playerId) ? 6 : 0;
}

/** A plain reading of how close the player is, without spoiling the check. */
export function ambitionProgress(game) {
  const ambition = ambitionOf(game, game.playerId);
  if (!ambition) return null;
  return {
    ...ambition,
    met: achieved(game, game.playerId),
    // Ambitions are pass/fail by design; the interface says which, not how far.
    hint: achieved(game, game.playerId)
      ? t('ambition.onTrack', 'As things stand, this is met.')
      : t('ambition.notYet', 'As things stand, this is not met.'),
  };
}

export { clamp };
