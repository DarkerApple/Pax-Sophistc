// Treaties: the paper that binds two governments to each other.
//
// There was a `game.treaties` array from the beginning. One order pushed to it
// and nothing anywhere ever read it, which meant a mutual defence pact was a
// line in a save file and a sentence in a briefing. This module is what that
// array should have been.
//
// A treaty here has a kind, a term, obligations that are checked every quarter,
// and a price for walking away from it. Defence pacts pull real allies into
// real wars; intelligence pacts show you things; trade pacts pay. And every one
// of them can be proposed, renewed, invoked or torn up by the player, which is
// what makes the diplomacy tab something other than a list of relation nudges.

import {
  adjustRelation,
  blocsOf,
  clamp,
  combatPower,
  defOf,
  getRelation,
  isSovereign,
  logEvent,
  livePower,
  proximity,
  sovereignIds,
} from './state.js';
import { t, tNation } from '../i18n/index.js';

/**
 * The kinds of paper two governments can sign.
 *
 * `weight` is how much of an obligation it is, which decides how hard it is to
 * get signed and how badly reneging is taken. `term` is how many quarters it
 * runs before it has to be renewed — a treaty nobody renews quietly lapses,
 * which is how most of them end in life.
 */
export const TREATY_KINDS = {
  nonaggression: {
    id: 'nonaggression',
    name: 'Non-aggression pact',
    blurb: 'Neither of us opens hostilities against the other. It is the cheapest thing worth signing.',
    weight: 1,
    term: 16,
    minRelation: -30,
    icon: '⊘',
  },
  trade: {
    id: 'trade',
    name: 'Trade and investment treaty',
    blurb: 'Tariffs down, capital across, and an arbitration annex neither side has read.',
    weight: 1,
    term: 20,
    minRelation: 0,
    icon: '⇄',
  },
  intelligence: {
    id: 'intelligence',
    name: 'Intelligence-sharing agreement',
    blurb: 'What we see, you see. Both services will hold something back, and both know it.',
    weight: 2,
    term: 12,
    minRelation: 30,
    icon: '◈',
  },
  access: {
    id: 'access',
    name: 'Basing and transit agreement',
    blurb: 'Runways, ports and overflight. It is worth more than a declaration and costs more too.',
    weight: 2,
    term: 16,
    minRelation: 25,
    icon: '⇱',
  },
  defence: {
    id: 'defence',
    name: 'Mutual defence pact',
    blurb: 'An attack on either of us is an attack on both. This one gets people killed.',
    weight: 4,
    term: 24,
    minRelation: 40,
    icon: '⛨',
  },
  umbrella: {
    id: 'umbrella',
    name: 'Extended deterrence guarantee',
    blurb: 'Our arsenal covers you. Everyone within range revises their planning the same afternoon.',
    weight: 5,
    term: 24,
    minRelation: 45,
    requiresNukes: true,
    icon: '☂',
  },
  alliance: {
    id: 'alliance',
    name: 'Full alliance',
    blurb: 'Not merely defence: your wars are our wars, whoever started them.',
    weight: 6,
    term: 24,
    minRelation: 60,
    icon: '⛓',
  },
};

export const TREATY_LIST = Object.values(TREATY_KINDS);

/** Kinds that put your army on the line for somebody else. */
const MILITARY_KINDS = new Set(['defence', 'alliance', 'umbrella']);

// ── Reading the file ────────────────────────────────────────────────────────

export function treatiesOf(game) {
  if (!Array.isArray(game.treaties)) game.treaties = [];
  return game.treaties;
}

/** Every live treaty a country is party to. */
export function treatiesFor(game, id) {
  return treatiesOf(game).filter((tr) => tr.active !== false && tr.members.includes(id));
}

/** The live treaty of a given kind between two countries, if any. */
export function treatyBetween(game, a, b, kind = null) {
  return treatiesOf(game).find(
    (tr) =>
      tr.active !== false &&
      tr.members.includes(a) &&
      tr.members.includes(b) &&
      (kind === null || tr.kind === kind),
  ) || null;
}

export function hasTreaty(game, a, b, kind = null) {
  return Boolean(treatyBetween(game, a, b, kind));
}

/**
 * Everyone bound to come to this country's defence, whether by a bilateral
 * pact or by a bloc that is a defensive alliance in fact as well as in name.
 */
export function alliesOf(game, id) {
  const out = new Map();

  for (const treaty of treatiesFor(game, id)) {
    if (!MILITARY_KINDS.has(treaty.kind)) continue;
    for (const member of treaty.members) {
      if (member === id || !isSovereign(game, member)) continue;
      const existing = out.get(member);
      const weight = TREATY_KINDS[treaty.kind].weight;
      if (!existing || existing.weight < weight) {
        out.set(member, { id: member, via: 'treaty', kind: treaty.kind, weight });
      }
    }
  }

  // Bloc membership is its own obligation, for the blocs that are actually
  // defensive alliances rather than trading clubs.
  const mine = blocsOf(game, id);
  for (const blocId of ['nato', 'csto', 'usAllied', 'sentinel', 'blueWater']) {
    if (!mine.includes(blocId)) continue;
    for (const other of sovereignIds(game)) {
      if (other === id || !blocsOf(game, other).includes(blocId)) continue;
      if (!out.has(other)) out.set(other, { id: other, via: 'bloc', kind: blocId, weight: 3 });
    }
  }

  return [...out.values()].sort((a, b) => b.weight - a.weight);
}

/** Whether an alliance obliges this country to join *offensive* wars too. */
export function isFullAlly(game, a, b) {
  return hasTreaty(game, a, b, 'alliance');
}

// ── Signing ─────────────────────────────────────────────────────────────────

/**
 * Whether a treaty of this kind could plausibly be signed right now, and why
 * not. Used both by the order's availability check and by the interface, so a
 * player is told the relation they need rather than watching an order fail.
 *
 * @returns {{ok: boolean, reason: string|null, chance: number}}
 */
export function canSign(game, a, b, kindId) {
  const kind = TREATY_KINDS[kindId];
  if (!kind) return { ok: false, reason: 'No such treaty.', chance: 0 };
  if (a === b) return { ok: false, reason: 'You cannot sign with yourself.', chance: 0 };
  if (!isSovereign(game, b)) return { ok: false, reason: 'There is nobody left to sign it.', chance: 0 };
  if (hasTreaty(game, a, b, kindId)) {
    return { ok: false, reason: t('treaty.already', 'That treaty already exists between you.'), chance: 0 };
  }
  if (kind.requiresNukes && game.nations[a].nukes <= 0) {
    return { ok: false, reason: t('treaty.needsArsenal', 'You have nothing to extend.'), chance: 0 };
  }

  const relation = getRelation(game, a, b);
  if (relation < kind.minRelation) {
    return {
      ok: false,
      reason: t('treaty.tooCold', 'Needs relations of at least {n}; they stand at {r}.',
        { n: kind.minRelation, r: Math.round(relation) }),
      chance: 0,
    };
  }
  if (findWar(game, a, b)) {
    return { ok: false, reason: t('treaty.atWar', 'You are at war with them.'), chance: 0 };
  }

  return { ok: true, reason: null, chance: signingChance(game, a, b, kind) };
}

function findWar(game, a, b) {
  return game.wars.find(
    (w) => w.active &&
      ((w.attackers.includes(a) && w.defenders.includes(b)) ||
       (w.defenders.includes(a) && w.attackers.includes(b))),
  );
}

/**
 * How likely they are to sign.
 *
 * A small country will sign almost anything with a great power; a great power
 * needs a reason. Being a threat to the world makes everybody slower to put
 * their name next to yours.
 */
export function signingChance(game, a, b, kind) {
  const relation = getRelation(game, a, b);
  const them = game.nations[b];
  const you = game.nations[a];
  const near = proximity(defOf(game, a), defOf(game, b));
  // Who needs whom. Being much the stronger party helps for a guarantee and
  // hurts for an alliance of equals.
  const gap = livePower(game, a) / Math.max(1, livePower(game, b));

  let chance =
    0.3 +
    (relation - kind.minRelation) / 130 +
    near * 0.12 +
    (you.influence - 50) / 260 -
    kind.weight * 0.05;

  if (MILITARY_KINDS.has(kind.id)) chance += Math.min(0.22, Math.log2(Math.max(0.2, gap)) * 0.12);
  if ((them.sanctionedBy || []).length) chance += 0.06;

  return clamp(chance, 0.05, 0.95);
}

/**
 * Sign it. The diplomatic wash is deliberately large: a defence pact is the
 * single loudest peacetime thing two governments can do.
 *
 * @returns {object|null} the treaty
 */
export function sign(game, a, b, kindId, rng, { term = null } = {}) {
  const kind = TREATY_KINDS[kindId];
  if (!kind) return null;

  const treaty = {
    id: `treaty-${kindId}-${game.turn}-${a}-${b}`,
    kind: kindId,
    members: [a, b],
    signedTurn: game.turn,
    expiresTurn: game.turn + (term ?? kind.term),
    // Rises when it is honoured, falls when it is strained. A treaty nobody
    // trusts is worth less than the paper the next one is printed on.
    credibility: 60,
    invocations: [],
    active: true,
  };
  treatiesOf(game).push(treaty);

  adjustRelation(game, a, b, 12 + kind.weight * 4);
  // Everyone else reads it. Their friends warm to you; their enemies do not.
  for (const other of sovereignIds(game)) {
    if (other === a || other === b) continue;
    const theirs = getRelation(game, b, other);
    if (theirs >= 45) adjustRelation(game, a, other, Math.round(kind.weight));
    if (theirs <= -45) adjustRelation(game, a, other, -Math.round(kind.weight * 2));
  }
  if (MILITARY_KINDS.has(kindId)) {
    game.worldTension = clamp(game.worldTension + kind.weight, 0, 100);
  }

  logEvent(game, {
    type: 'treaty',
    severity: 'major',
    text: t('treaty.signed', '{a} and {b} sign a {kind}.', {
      a: tNation(defOf(game, a)),
      b: tNation(defOf(game, b)),
      kind: t(`treatyKind.${kindId}`, kind.name).toLowerCase(),
    }),
    nations: [a, b],
  });
  return treaty;
}

/** Push the expiry back. Cheaper than signing, and it keeps credibility. */
export function renew(game, treatyId) {
  const treaty = treatiesOf(game).find((tr) => tr.id === treatyId && tr.active !== false);
  if (!treaty) return { ok: false, reason: 'No such treaty.' };
  const kind = TREATY_KINDS[treaty.kind];
  treaty.expiresTurn = game.turn + kind.term;
  treaty.credibility = clamp(treaty.credibility + 8);
  logEvent(game, {
    type: 'treaty',
    severity: 'info',
    text: t('treaty.renewed', 'The {kind} is renewed for another {n} quarters.',
      { kind: t(`treatyKind.${treaty.kind}`, kind.name).toLowerCase(), n: kind.term }),
    nations: [...treaty.members],
  });
  return { ok: true, treaty };
}

/**
 * Tear it up. The cost scales with how serious the treaty was and how much of
 * its term is left — walking out of a defence pact in year one is not the same
 * act as letting one lapse in year six.
 */
export function abrogate(game, treatyId, actorId) {
  const treaty = treatiesOf(game).find((tr) => tr.id === treatyId && tr.active !== false);
  if (!treaty) return { ok: false, reason: 'No such treaty.' };
  const kind = TREATY_KINDS[treaty.kind];
  const other = treaty.members.find((m) => m !== actorId);
  const left = Math.max(0, treaty.expiresTurn - game.turn);

  treaty.active = false;
  treaty.endedTurn = game.turn;
  treaty.ending = 'abrogated';
  treaty.abrogatedBy = actorId;

  const state = game.nations[actorId];
  const sting = kind.weight * (1 + left / kind.term);
  state.influence = clamp(state.influence - sting * 1.6);
  adjustRelation(game, actorId, other, -Math.round(18 + sting * 4));
  // And everybody who has paper with you wonders what it is worth.
  for (const partner of partnersOf(game, actorId)) {
    adjustRelation(game, actorId, partner, -Math.round(sting));
    const theirs = treatyBetween(game, actorId, partner);
    if (theirs) theirs.credibility = clamp(theirs.credibility - sting * 3);
  }

  logEvent(game, {
    type: 'treaty',
    severity: 'major',
    text: t('treaty.abrogated',
      '{a} withdraws from its {kind} with {b}, {n} quarters early. Every other government with your signature on something reads it twice.',
      {
        a: tNation(defOf(game, actorId)),
        b: tNation(defOf(game, other)),
        kind: t(`treatyKind.${treaty.kind}`, kind.name).toLowerCase(),
        n: left,
      }),
    nations: [actorId, other],
  });
  return { ok: true, treaty, cost: sting };
}

/** Everyone you currently have any paper with. */
export function partnersOf(game, id) {
  const out = new Set();
  for (const treaty of treatiesFor(game, id)) {
    for (const member of treaty.members) if (member !== id) out.add(member);
  }
  return [...out];
}

// ── The quarter ─────────────────────────────────────────────────────────────

/**
 * Treaties expire, pay out and slowly gain credibility for not being broken.
 * Called once a quarter.
 *
 * @returns {{expired: Array, benefits: object}}
 */
export function tickTreaties(game, rng) {
  const expired = [];
  for (const treaty of treatiesOf(game)) {
    if (treaty.active === false) continue;
    if (game.turn >= treaty.expiresTurn) {
      treaty.active = false;
      treaty.endedTurn = game.turn;
      treaty.ending = 'lapsed';
      expired.push(treaty);
      if (treaty.members.includes(game.playerId)) {
        logEvent(game, {
          type: 'treaty',
          severity: 'info',
          text: t('treaty.lapsed', 'The {kind} with {other} lapses. Nobody tore it up; nobody renewed it either.', {
            kind: t(`treatyKind.${treaty.kind}`, TREATY_KINDS[treaty.kind].name).toLowerCase(),
            other: tNation(defOf(game, treaty.members.find((m) => m !== game.playerId))),
          }),
          nations: [...treaty.members],
        });
      }
      continue;
    }
    // Kept, quarter by quarter, is what a treaty is worth.
    treaty.credibility = clamp(treaty.credibility + 0.8);
  }

  game.treaties = treatiesOf(game).filter(
    (tr) => tr.active !== false || game.turn - (tr.endedTurn ?? 0) < 20,
  );

  return { expired, benefits: applyBenefits(game) };
}

/**
 * What being party to something is actually worth this quarter.
 *
 * Applied to the player only — the AI's treaties matter through who joins whose
 * wars, which is the part that shows.
 */
function applyBenefits(game) {
  const id = game.playerId;
  const state = game.nations[id];
  const out = { growth: 0, readiness: 0, intel: [] };

  for (const treaty of treatiesFor(game, id)) {
    const other = treaty.members.find((m) => m !== id);
    if (!other || !isSovereign(game, other)) continue;
    const weight = treaty.credibility / 100;

    switch (treaty.kind) {
      case 'trade':
        out.growth += 0.06 * weight;
        break;
      case 'access':
        out.readiness += 0.5 * weight;
        break;
      case 'intelligence':
        // Their service is your service, at a discount.
        if (!game.intel) game.intel = {};
        for (const target of sovereignIds(game)) {
          if (target === id || target === other) continue;
          if (getRelation(game, other, target) > -20) continue;
          game.intel[target] = clamp(
            (game.intel[target] ?? 0) + 0.02 * weight, 0, 0.9,
          );
        }
        out.intel.push(other);
        break;
      case 'umbrella':
        out.readiness += 0.2 * weight;
        break;
      default:
        break;
    }
  }

  if (out.growth) {
    state.baseGrowth = Number((state.baseGrowth + out.growth * 0.02).toFixed(3));
  }
  if (out.readiness) state.readiness = clamp(state.readiness + out.readiness);
  return out;
}

// ── Invocation ──────────────────────────────────────────────────────────────

/**
 * Call your allies in.
 *
 * Whether they come depends on the paper, on how much they like you, on whether
 * they think they can survive it, and on whether you started it — a defence
 * pact is a defence pact, and a war you opened is not a defence.
 *
 * @returns {{called: Array, joined: Array, refused: Array}}
 */
export function invoke(game, war, callerId, rng) {
  const attacking = war.attackers.includes(callerId);
  const already = new Set([...war.attackers, ...war.defenders]);
  const side = attacking ? war.attackers : war.defenders;
  const enemies = attacking ? war.defenders : war.attackers;

  const called = alliesOf(game, callerId).filter((ally) => !already.has(ally.id));
  const joined = [];
  const refused = [];

  for (const ally of called) {
    const treaty = treatyBetween(game, callerId, ally.id);
    // A defence pact does not cover a war you started. A full alliance does.
    const covered = !attacking || ally.kind === 'alliance';
    const relation = getRelation(game, callerId, ally.id);
    const theirRisk = Math.max(...enemies.map((e) => combatPower(game, e))) /
      Math.max(1, combatPower(game, ally.id));

    // Willingness first, obligation second — and obligation is a multiplier, not
    // a bonus. Otherwise a warm enough relationship quietly turns a defence pact
    // into an alliance, and the distinction between the two stops existing.
    const willing =
      0.55 +
      relation / 320 +
      ((treaty?.credibility ?? 55) - 55) / 260 +
      ally.weight * 0.03 -
      Math.min(0.3, Math.log2(Math.max(1, theirRisk)) * 0.12);

    const chance = clamp(willing * (covered ? 1 : 0.26), 0.02, 0.95);

    if (rng.bool(chance)) {
      side.push(ally.id);
      joined.push(ally);
      if (treaty) treaty.credibility = clamp(treaty.credibility + 12);
      for (const enemy of enemies) adjustRelation(game, ally.id, enemy, -45);
      adjustRelation(game, callerId, ally.id, 12);
    } else {
      refused.push(ally);
      if (treaty && covered) {
        // Refusing an obligation you actually signed is what destroys paper.
        treaty.credibility = clamp(treaty.credibility - 28);
        adjustRelation(game, callerId, ally.id, -30);
      }
    }
  }

  if (called.length) {
    war.invocations = [...(war.invocations || []), { turn: game.turn, callerId, joined: joined.map((a) => a.id) }];
    logEvent(game, {
      type: 'treaty',
      severity: joined.length ? 'critical' : 'major',
      text: joined.length
        ? t('treaty.answered', '{caller} invokes its treaties. {list} come in.', {
            caller: tNation(defOf(game, callerId)),
            list: joined.map((a) => tNation(defOf(game, a.id))).join(', '),
          })
        : t('treaty.unanswered',
            '{caller} invokes its treaties and nobody moves. The paper is still on the table and everybody can see what it is worth.',
            { caller: tNation(defOf(game, callerId)) }),
      nations: [callerId, ...joined.map((a) => a.id)],
    });
  }

  return { called, joined, refused };
}

/**
 * Allies who are not fighting send what they can: money, materiel, and the odd
 * squadron nobody will admit to. Called once a quarter for every war.
 *
 * @returns {Array<{from: string, to: string, kind: string, amount: number}>}
 */
export function alliedAid(game, rng) {
  const sent = [];
  for (const war of game.wars) {
    if (!war.active) continue;
    const combatants = new Set([...war.attackers, ...war.defenders]);

    for (const belligerent of combatants) {
      if (!isSovereign(game, belligerent)) continue;
      const defending = war.defenders.includes(belligerent);

      for (const ally of alliesOf(game, belligerent)) {
        if (combatants.has(ally.id) || !isSovereign(game, ally.id)) continue;
        // People help a defender readily and an aggressor reluctantly.
        const willing = (defending ? 0.34 : 0.1) + ally.weight * 0.04 +
          getRelation(game, belligerent, ally.id) / 400;
        if (!rng.bool(clamp(willing, 0, 0.8))) continue;

        const donor = game.nations[ally.id];
        const receiver = game.nations[belligerent];
        // Never enough to hurt the giver; always enough to notice.
        const money = Math.round(donor.gdp * 1000 * 0.004 * ally.weight);
        donor.treasury -= money;
        receiver.treasury += money;
        receiver.readiness = clamp(receiver.readiness + rng.float(0.6, 2.2));

        const side = defending ? 'defenders' : 'attackers';
        war.exhaustion[side] = clamp(war.exhaustion[side] - rng.float(0.5, 2), 0, 100);

        sent.push({ from: ally.id, to: belligerent, kind: 'materiel', amount: money, warId: war.id });
      }
    }
  }

  // Only the player's own ledger is worth a line in the briefing.
  const mine = sent.filter((s) => s.to === game.playerId || s.from === game.playerId);
  for (const entry of mine.slice(0, 3)) {
    logEvent(game, {
      type: 'treaty',
      severity: 'info',
      text: entry.to === game.playerId
        ? t('treaty.aidIn', '{from} sends ${n}B of materiel and credit.', {
            from: tNation(defOf(game, entry.from)), n: entry.amount.toLocaleString() })
        : t('treaty.aidOut', 'You send {to} ${n}B of materiel and credit.', {
            to: tNation(defOf(game, entry.to)), n: entry.amount.toLocaleString() }),
      nations: [entry.from, entry.to],
    });
  }

  return sent;
}

// ── For the interface ───────────────────────────────────────────────────────

/** Everything the treaties panel needs, live and lapsed. */
export function treatyReport(game, id = game.playerId) {
  const live = treatiesFor(game, id).map((treaty) => {
    const other = treaty.members.find((m) => m !== id);
    return {
      ...treaty,
      kindSpec: TREATY_KINDS[treaty.kind],
      other,
      otherDef: defOf(game, other),
      quartersLeft: Math.max(0, treaty.expiresTurn - game.turn),
      expiringSoon: treaty.expiresTurn - game.turn <= 4,
      relation: getRelation(game, id, other),
    };
  }).sort((a, b) => b.kindSpec.weight - a.kindSpec.weight || a.quartersLeft - b.quartersLeft);

  const lapsed = treatiesOf(game)
    .filter((tr) => tr.active === false && tr.members.includes(id))
    .slice(-4)
    .reverse()
    .map((treaty) => ({
      ...treaty,
      kindSpec: TREATY_KINDS[treaty.kind],
      otherDef: defOf(game, treaty.members.find((m) => m !== id)),
    }));

  return { live, lapsed, allies: alliesOf(game, id) };
}
