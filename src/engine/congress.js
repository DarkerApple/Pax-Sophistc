// The last act.
//
// A term used to simply stop. Now, in the closing year, a world congress
// convenes and the assembled governments vote on how the next order is written:
// freeze the borders where they stand, ban a class of weapon, recognise a bloc
// as legitimate, carve out a sphere for whoever can hold one.
//
// Nothing here is a new subsystem. The votes are decided by the things forty
// quarters of play already produced — who likes you, whose bloc you are in, how
// much of the world's power you carry, and whether the room has decided you are
// the problem. Quiet diplomacy that never had a payoff now has one, in a single
// session, at the end.
//
// The player's leverage is political capital and the mandate they are running
// on. You can propose one clause, and you can lobby three times.

import { BLOCS } from '../data/nations.js';
import { threatOf } from './coalitions.js';
import { areaOf, startingAreaOf } from './territory.js';
import {
  adjustRelation,
  blocsOf,
  clamp,
  defOf,
  getRelation,
  livePower,
  logEvent,
  sovereignIds,
} from './state.js';
import { t, tNation } from '../i18n/index.js';

/** How many quarters before the end the congress opens. */
export const CONGRESS_LEAD = 4;

/**
 * The clauses that can be put to the floor.
 *
 * Each declares who tends to favour it (`appeal`, returning −1..1 for a given
 * country) and what passing it actually does. Keeping the appeal function next
 * to the effect is what makes a clause four lines instead of a subsystem.
 */
export const CLAUSE_TYPES = [
  {
    id: 'freeze-borders',
    title: 'Freeze the borders where they stand',
    detail: 'No further territorial revision is recognised. Whoever holds ground at the close, keeps it.',
    // Winners want the music to stop; losers want it to keep playing.
    appeal: (game, id) => {
      const gained = areaOf(game, id) / Math.max(1, startingAreaOf(game, id)) - 1;
      return clamp(gained * 6 + 0.15 - threatOf(game, id) * 0.4, -1, 1);
    },
    apply: (game) => {
      game.worldTension = clamp(game.worldTension - 12, 0, 100);
      game.congressEffects = { ...(game.congressEffects || {}), bordersFrozen: true };
    },
  },
  {
    id: 'ban-weapons',
    title: 'Ban the weapon class outright',
    detail: 'Nuclear release becomes a crime against the order rather than an option of last resort.',
    appeal: (game, id) => {
      const state = game.nations[id];
      // The people who have them are the people who do not want them banned.
      return clamp(0.55 - (state.nukes > 0 ? 1.1 : 0) - threatOf(game, id) * 0.3, -1, 1);
    },
    apply: (game) => {
      game.worldTension = clamp(game.worldTension - 18, 0, 100);
      game.congressEffects = { ...(game.congressEffects || {}), weaponsBanned: true };
    },
  },
  {
    id: 'recognise-bloc',
    title: 'Recognise the bloc as a legitimate order',
    detail: 'One organisation is written into the settlement as a guarantor rather than a party.',
    needsBloc: true,
    appeal: (game, id, clause) => {
      const inside = blocsOf(game, id).includes(clause.blocId);
      if (inside) return 0.9;
      const members = sovereignIds(game).filter((n) => blocsOf(game, n).includes(clause.blocId));
      const warmth = members.length
        ? members.reduce((s, m) => s + getRelation(game, id, m), 0) / members.length
        : 0;
      return clamp(warmth / 90 - 0.25, -1, 1);
    },
    apply: (game, clause) => {
      for (const id of sovereignIds(game)) {
        if (!blocsOf(game, id).includes(clause.blocId)) continue;
        game.nations[id].influence = clamp(game.nations[id].influence + 6);
      }
      game.congressEffects = { ...(game.congressEffects || {}), recognisedBloc: clause.blocId };
    },
  },
  {
    id: 'spheres',
    title: 'Divide the world into recognised spheres',
    detail: 'The great powers are handed their neighbourhoods, and everyone else is handed a neighbour.',
    appeal: (game, id) => {
      const share = livePower(game, id) / Math.max(1, totalPower(game));
      // A frank clause: the strong like it and say so, the small loathe it.
      return clamp(share * 14 - 0.55, -1, 1);
    },
    apply: (game) => {
      game.worldTension = clamp(game.worldTension + 8, 0, 100);
      for (const id of sovereignIds(game)) {
        const share = livePower(game, id) / Math.max(1, totalPower(game));
        game.nations[id].influence = clamp(game.nations[id].influence + (share > 0.06 ? 8 : -5));
      }
      game.congressEffects = { ...(game.congressEffects || {}), spheres: true };
    },
  },
  {
    id: 'open-trade',
    title: 'Bind the whole assembly to open trade',
    detail: 'Tariff walls and sanctions regimes come down together, or not at all.',
    // Everyone says they want open trade. The ones who would actually lose an
    // industry to it vote the other way, which is what makes it a vote.
    appeal: (game, id) => {
      const state = game.nations[id];
      const sanctioned = (state.sanctionedBy || []).length > 0;
      return clamp(
        0.1 + (sanctioned ? 0.6 : 0) + (state.tech - 62) / 85 - Math.max(0, state.unrest - 40) / 60,
        -1,
        1,
      );
    },
    apply: (game) => {
      for (const id of sovereignIds(game)) {
        game.nations[id].sanctionedBy = [];
        game.nations[id].modifiers.push({
          id: 'congress-trade', label: 'Open-trade settlement', turnsLeft: 12,
          growth: 0.22, stability: 0, unrest: 0, influence: 0, readiness: 0, tech: 0.1,
          revenue: 0, source: 'congress',
        });
      }
      game.congressEffects = { ...(game.congressEffects || {}), openTrade: true };
    },
  },
  {
    id: 'right-of-secession',
    title: 'Recognise a right of secession',
    detail: 'A province that leaves is a state, not a rebellion. Everyone with a restive region reads this twice.',
    appeal: (game, id) => {
      const state = game.nations[id];
      const born = Object.values(game.customNations || {}).some((d) => d.parentId === id);
      return clamp(0.2 - (state.unrest - 40) / 60 - (born ? 0.9 : 0), -1, 1);
    },
    apply: (game) => {
      for (const def of Object.values(game.customNations || {})) {
        const state = game.nations[def.id];
        if (state) state.influence = clamp(state.influence + 12);
      }
      game.congressEffects = { ...(game.congressEffects || {}), secessionRight: true };
    },
  },
  {
    id: 'collective-security',
    title: 'Bind the assembly to collective security',
    detail: 'An attack on any signatory is an attack on the settlement itself.',
    // Small states want a guarantee; the powers who would have to honour it are
    // markedly less enthusiastic about signing one.
    appeal: (game, id) =>
      clamp(
        0.4 - threatOf(game, id) * 1.6 - (livePower(game, id) / Math.max(1, totalPower(game))) * 9,
        -1,
        1,
      ),
    apply: (game) => {
      game.worldTension = clamp(game.worldTension - 14, 0, 100);
      game.congressEffects = { ...(game.congressEffects || {}), collectiveSecurity: true };
    },
  },
];

export const CLAUSE_TYPES_BY_ID = Object.fromEntries(CLAUSE_TYPES.map((c) => [c.id, c]));

function totalPower(game) {
  return sovereignIds(game).reduce((sum, id) => sum + livePower(game, id), 0);
}

// ── Voting weight ───────────────────────────────────────────────────────────

/**
 * How much one country's vote is worth.
 *
 * Power carries most of it, but not all: a bloc votes together and therefore
 * counts for more than its members do apart, and a country the room has decided
 * is a menace is listened to less. That is the whole design — forty quarters of
 * relations and bloc-building convert into votes here.
 */
export function voteWeight(game, id) {
  const share = livePower(game, id) / Math.max(1, totalPower(game));
  const blocs = blocsOf(game, id).length;
  const standing = game.nations[id].influence / 100;
  const suspicion = threatOf(game, id);
  return Number(clamp(
    share * 55 + standing * 0.9 + blocs * 0.22 - suspicion * 0.8,
    0.05,
    9,
  ).toFixed(3));
}

/**
 * How one country votes on one clause: its own interest, plus how it feels
 * about whoever proposed it, plus whatever lobbying has been done.
 *
 * @returns {{id: string, weight: number, lean: number, vote: 'for'|'against'|'abstain'}}
 */
export function voteOf(game, id, clause) {
  const type = CLAUSE_TYPES_BY_ID[clause.typeId];
  const interest = type ? type.appeal(game, id, clause) : 0;

  let lean = interest;
  if (clause.proposerId && clause.proposerId !== id) {
    // You do not vote for your enemy's settlement because it happens to suit
    // you, and you will vote for a friend's against mild self-interest.
    lean += getRelation(game, id, clause.proposerId) / 190;
    if (threatOf(game, clause.proposerId) > 0.45) lean -= 0.25;
  }
  lean += (clause.lobby?.[id] ?? 0);

  const vote = lean > 0.12 ? 'for' : lean < -0.12 ? 'against' : 'abstain';
  return { id, weight: voteWeight(game, id), lean: Number(lean.toFixed(3)), vote };
}

/** The floor as it currently stands, without holding the vote. */
export function tally(game, clause) {
  const votes = sovereignIds(game).map((id) => voteOf(game, id, clause));
  const forWeight = votes.filter((v) => v.vote === 'for').reduce((s, v) => s + v.weight, 0);
  const againstWeight = votes.filter((v) => v.vote === 'against').reduce((s, v) => s + v.weight, 0);
  const abstained = votes.filter((v) => v.vote === 'abstain');
  const abstainWeight = abstained.reduce((s, v) => s + v.weight, 0);
  // Abstentions are not neutral in a room writing a settlement: a government
  // that will not put its name to a clause is a government the clause has to
  // carry anyway. They count half against, which is what stops a clause nobody
  // actively opposes from passing on the votes of four enthusiasts.
  const total = forWeight + againstWeight + abstainWeight * 0.5 || 1;
  return {
    votes,
    forWeight: Number(forWeight.toFixed(2)),
    againstWeight: Number(againstWeight.toFixed(2)),
    abstainWeight: Number(abstainWeight.toFixed(2)),
    share: Number((forWeight / total).toFixed(3)),
    // A settlement clause needs a real majority of the weight in the room.
    passing: forWeight / total >= 0.55,
  };
}

// ── The session ─────────────────────────────────────────────────────────────

export function congressDue(game) {
  return game.turn >= game.totalTurns - CONGRESS_LEAD && game.status === 'active';
}

export function congressOf(game) {
  return game.congress || null;
}

/**
 * Convene: pick the clauses on the order paper, and leave one seat for the
 * player's own proposal.
 */
export function convene(game, rng) {
  if (game.congress) return game.congress;

  const pool = CLAUSE_TYPES.filter((type) => {
    if (type.id === 'ban-weapons') return sovereignIds(game).some((id) => game.nations[id].nukes > 0);
    if (type.id === 'right-of-secession') return Object.keys(game.customNations || {}).length > 0;
    return true;
  });

  const chosen = [];
  const available = [...pool];
  for (let i = 0; i < 3 && available.length; i++) {
    const type = rng.pick(available);
    available.splice(available.indexOf(type), 1);
    chosen.push(makeClause(game, type, rng, null));
  }

  game.congress = {
    openedTurn: game.turn,
    clauses: chosen,
    lobbyLeft: 3,
    proposalUsed: false,
    resolved: false,
    results: null,
  };

  logEvent(game, {
    type: 'congress',
    severity: 'critical',
    text: t('congress.convened',
      'A world congress convenes. Every government in the room has come to write the next order, and every one of them has come with a list.'),
    nations: [game.playerId],
  });
  return game.congress;
}

function makeClause(game, type, rng, proposerId) {
  const clause = {
    id: `${type.id}-${game.turn}-${rng.int(100, 999)}`,
    typeId: type.id,
    title: type.title,
    detail: type.detail,
    proposerId,
    lobby: {},
  };
  if (type.needsBloc) {
    const blocs = Object.values(BLOCS).filter((b) =>
      sovereignIds(game).some((id) => blocsOf(game, id).includes(b.id)));
    const bloc = blocs.length
      ? rng.weighted(blocs, (b) => sovereignIds(game).filter((id) => blocsOf(game, id).includes(b.id)).length)
      : null;
    clause.blocId = bloc?.id || 'nato';
    clause.title = `${type.title}: ${bloc ? bloc.name : 'NATO'}`;
  }
  return clause;
}

/** The player's one proposal, paid for in political capital. */
export function propose(game, typeId, rng, { blocId = null } = {}) {
  const congress = congressOf(game);
  if (!congress || congress.resolved) return { ok: false, reason: 'The floor is closed.' };
  if (congress.proposalUsed) return { ok: false, reason: t('congress.oneProposal', 'You get one proposal.') };
  const type = CLAUSE_TYPES_BY_ID[typeId];
  if (!type) return { ok: false, reason: 'No such clause.' };
  if (game.politicalCapital < 3) {
    return { ok: false, reason: t('congress.needsCapital', 'Putting a clause on the paper costs 3 political capital.') };
  }

  game.politicalCapital -= 3;
  const clause = makeClause(game, type, rng, game.playerId);
  if (blocId && type.needsBloc) {
    clause.blocId = blocId;
    clause.title = `${type.title}: ${t(`bloc.${blocId}`, BLOCS[blocId]?.name || blocId)}`;
  }
  congress.clauses.push(clause);
  congress.proposalUsed = true;
  return { ok: true, clause };
}

/**
 * Lobby one country on one clause.
 *
 * Costs a political capital, and how far it moves them depends on your standing
 * with them and on the mandate you are running on — a government with a record
 * is listened to, and a government without one is not.
 */
export function lobby(game, clauseId, targetId, score) {
  const congress = congressOf(game);
  if (!congress || congress.resolved) return { ok: false, reason: 'The floor is closed.' };
  if (congress.lobbyLeft <= 0) return { ok: false, reason: t('congress.noLobbying', 'You are out of meetings.') };
  if (game.politicalCapital < 1) return { ok: false, reason: t('congress.needsOne', 'Needs 1 political capital.') };
  const clause = congress.clauses.find((c) => c.id === clauseId);
  if (!clause) return { ok: false, reason: 'No such clause.' };

  const you = game.nations[game.playerId];
  const relation = getRelation(game, game.playerId, targetId);
  const record = ((score?.total ?? 50) - 50) / 130;
  const shift = clamp(
    0.18 + relation / 260 + you.influence / 340 + record - threatOf(game, game.playerId) * 0.2,
    -0.1,
    0.6,
  );

  game.politicalCapital -= 1;
  congress.lobbyLeft -= 1;
  clause.lobby[targetId] = Number(((clause.lobby[targetId] ?? 0) + shift).toFixed(3));
  return { ok: true, shift: Number(shift.toFixed(3)), left: congress.lobbyLeft };
}

/** Hold the vote on everything on the paper. Once. */
export function resolveCongress(game, rng) {
  const congress = congressOf(game);
  if (!congress || congress.resolved) return congress?.results || null;

  const results = congress.clauses.map((clause) => {
    const result = tally(game, clause);
    const passed = result.passing;
    if (passed) {
      const type = CLAUSE_TYPES_BY_ID[clause.typeId];
      type?.apply(game, clause);
      // Signing a settlement warms the room to whoever wrote it.
      if (clause.proposerId) {
        for (const vote of result.votes) {
          if (vote.id === clause.proposerId || vote.vote !== 'for') continue;
          adjustRelation(game, clause.proposerId, vote.id, 8);
        }
      }
    }
    logEvent(game, {
      type: 'congress',
      severity: passed ? 'major' : 'info',
      text: passed
        ? t('congress.passed', '“{title}” carries with {pct}% of the weight of the room.',
            { title: clause.title, pct: Math.round(result.share * 100) })
        : t('congress.failed', '“{title}” fails, with {pct}% behind it.',
            { title: clause.title, pct: Math.round(result.share * 100) }),
      nations: [clause.proposerId, game.playerId].filter(Boolean),
    });
    return { clause, ...result, passed, yours: clause.proposerId === game.playerId };
  });

  congress.resolved = true;
  congress.results = results;
  congress.resolvedTurn = game.turn;
  return results;
}

/** How the session went for you, for the closing page and the score. */
export function congressOutcome(game) {
  const congress = congressOf(game);
  if (!congress?.results) return null;
  const yours = congress.results.filter((r) => r.yours);
  const carried = congress.results.filter((r) => r.passed);
  const withYou = congress.results.filter((r) => {
    const your = r.votes.find((v) => v.id === game.playerId);
    return your && ((your.vote === 'for') === r.passed);
  });
  return {
    proposed: yours.length,
    yoursCarried: yours.filter((r) => r.passed).length,
    carried: carried.length,
    total: congress.results.length,
    wentYourWay: withYou.length,
    // The line the ending screen leads with.
    verdict: yours.some((r) => r.passed)
      ? 'wrote part of the settlement'
      : withYou.length > congress.results.length / 2
        ? 'was on the winning side of it'
        : 'watched it written by others',
  };
}
