// The rules you inherited, and the one you are allowed to change.
//
// Every country has a short constitution: how many terms its executive may
// serve, who may take it to war, whether it can rule by decree, whether it can
// sign a treaty without a ratifying vote. These are not flavour — they gate
// real orders, and the gate is the reason the amendment matters.
//
// You get one amendment per term. Removing your own term limit is the obvious
// use of it, and the country will notice: an executive who rewrites the rule
// that would have removed him pays for it in every faction at once.

import { clamp, defOf, logEvent } from './state.js';
import { t, tNation } from '../i18n/index.js';

/**
 * The clauses a constitution can carry. Each is a lever with two or three
 * settings, a plain description of what it does, and what it costs to change.
 */
export const CLAUSES = [
  {
    id: 'termLimit',
    name: 'Term limits',
    settings: [
      { value: 1, label: 'One term only', note: 'You leave when this term ends, whatever the country thinks.' },
      { value: 2, label: 'Two terms', note: 'You may stand once more, if the country will have you.' },
      { value: 3, label: 'Three terms', note: 'A long horizon, and a long argument about it.' },
      { value: 0, label: 'No limit', note: 'You stand as often as you can win. Everyone understands what this is.' },
    ],
    // Removing your own limit is the single most expensive thing you can do.
    costOf: (from, to) => (to === 0 ? 5 : to > from ? 4 : 2),
    backlash: (from, to) => (to === 0 ? 22 : to > from ? 12 : -4),
  },
  {
    id: 'warPowers',
    name: 'War powers',
    settings: [
      { value: 'executive', label: 'Executive', note: 'You may declare war on your own authority.' },
      { value: 'legislature', label: 'Legislature', note: 'A declaration needs your own side behind it.' },
      { value: 'referendum', label: 'The country', note: 'A declaration needs the public behind it. In practice, that means almost never.' },
    ],
    costOf: (from, to) => (to === 'executive' ? 4 : 2),
    backlash: (from, to) => (to === 'executive' ? 14 : -6),
  },
  {
    id: 'emergencyPowers',
    name: 'Emergency powers',
    settings: [
      { value: 'permitted', label: 'Permitted', note: 'You may suspend normal government during a crisis.' },
      { value: 'restricted', label: 'Restricted', note: 'Rule by decree is not available to you at any price.' },
    ],
    costOf: (from, to) => (to === 'permitted' ? 4 : 2),
    backlash: (from, to) => (to === 'permitted' ? 16 : -8),
  },
  {
    id: 'ratification',
    name: 'Treaty ratification',
    settings: [
      { value: 'required', label: 'Required', note: 'Acceding to or leaving a bloc costs more and moves slower.' },
      { value: 'executive', label: 'Executive', note: 'You sign, and it is signed.' },
    ],
    costOf: () => 3,
    backlash: (from, to) => (to === 'executive' ? 10 : -4),
  },
  {
    id: 'pressFreedom',
    name: 'The press',
    settings: [
      { value: 'free', label: 'Free', note: 'Bad quarters are reported as bad quarters.' },
      { value: 'managed', label: 'Managed', note: 'Unrest bites more slowly, and nobody abroad believes your figures.' },
    ],
    costOf: (from, to) => (to === 'managed' ? 3 : 2),
    backlash: (from, to) => (to === 'managed' ? 15 : -10),
  },
];

export const CLAUSES_BY_ID = Object.fromEntries(CLAUSES.map((c) => [c.id, c]));

/**
 * A country's founding constitution, inferred from what kind of state it is.
 *
 * Deliberately coarse: five clauses that each gate something the player would
 * otherwise do without thinking.
 */
export function foundingConstitution(def) {
  const government = String(def.government || '').toLowerCase();

  const authoritarian = /one-party|junta|absolute|theocra|revolutionary|provisional/.test(government);
  const parliamentary = /parliamentary|constitutional monarchy|federal parliamentary/.test(government);
  const presidential = /republic|presidential|federal republic/.test(government);

  if (authoritarian) {
    return {
      termLimit: 0,
      warPowers: 'executive',
      emergencyPowers: 'permitted',
      ratification: 'executive',
      pressFreedom: 'managed',
      amendmentsUsed: 0,
      amendments: [],
    };
  }
  if (parliamentary) {
    return {
      termLimit: 3,
      warPowers: 'legislature',
      emergencyPowers: 'restricted',
      ratification: 'required',
      pressFreedom: 'free',
      amendmentsUsed: 0,
      amendments: [],
    };
  }
  return {
    termLimit: presidential ? 2 : 2,
    warPowers: presidential ? 'executive' : 'legislature',
    emergencyPowers: 'restricted',
    ratification: 'required',
    pressFreedom: 'free',
    amendmentsUsed: 0,
    amendments: [],
  };
}

export function constitutionOf(game) {
  if (!game.constitution) game.constitution = foundingConstitution(defOf(game, game.playerId));
  return game.constitution;
}

/** The clause settings as readable lines, for the interface. */
export function describeConstitution(game) {
  const constitution = constitutionOf(game);
  return CLAUSES.map((clause) => {
    const value = constitution[clause.id];
    const setting = clause.settings.find((s) => s.value === value) || clause.settings[0];
    return {
      id: clause.id,
      name: clause.name,
      value,
      label: setting.label,
      note: setting.note,
      amendedThisTerm: (constitution.amendments || []).some(
        (a) => a.clauseId === clause.id && a.term === (game.term || 1),
      ),
    };
  });
}

// ── Gates ───────────────────────────────────────────────────────────────────

/**
 * Whether the constitution permits an order at all, and what it says if not.
 *
 * Called from actionAvailability, so a blocked order is blocked at the point of
 * ordering with the clause named rather than failing silently.
 *
 * @returns {{ok: boolean, reason: string|null, clauseId: string|null}}
 */
export function permits(game, action) {
  const constitution = constitutionOf(game);
  const player = game.nations[game.playerId];

  if (action.declaresWar) {
    if (constitution.warPowers === 'referendum') {
      // Not impossible — but it takes a country that already wants it.
      if (player.approval < 62 || game.worldTension < 55) {
        return {
          ok: false,
          clauseId: 'warPowers',
          reason: t('constitution.needsReferendum',
            'Only the country may declare war, and it is not in the mood. You would need approval above 62 and a world already tense.'),
        };
      }
    } else if (constitution.warPowers === 'legislature') {
      if (player.stability < 40 || player.approval < 38) {
        return {
          ok: false,
          clauseId: 'warPowers',
          reason: t('constitution.needsLegislature',
            'A declaration needs your own side behind it, and at this approval it would not pass.'),
        };
      }
    }
  }

  if (action.id === 'emergency-powers' && constitution.emergencyPowers === 'restricted') {
    return {
      ok: false,
      clauseId: 'emergencyPowers',
      reason: t('constitution.noEmergency', 'Rule by decree is not available under this constitution.'),
    };
  }

  if (action.id === 'surveillance-state' && constitution.pressFreedom === 'free' && player.approval < 50) {
    return {
      ok: false,
      clauseId: 'pressFreedom',
      reason: t('constitution.noSurveillance',
        'A free press and an unpopular government cannot build this together. Raise approval, or change one of the two.'),
    };
  }

  if (action.alignment && constitution.ratification === 'required' && game.politicalCapital < action.pc + 1) {
    return {
      ok: false,
      clauseId: 'ratification',
      reason: t('constitution.needsRatification',
        'Treaties need ratifying here, which costs one more political capital than the signature does.'),
    };
  }

  return { ok: true, reason: null, clauseId: null };
}

/** Amendments left this term. One, unless you have already used it. */
export function amendmentsLeft(game) {
  const constitution = constitutionOf(game);
  const term = game.term || 1;
  const used = (constitution.amendments || []).filter((a) => a.term === term).length;
  return Math.max(0, 1 - used);
}

/** Every change you could make right now, with its price. */
export function amendmentOptions(game) {
  const constitution = constitutionOf(game);
  const options = [];
  for (const clause of CLAUSES) {
    const from = constitution[clause.id];
    for (const setting of clause.settings) {
      if (setting.value === from) continue;
      options.push({
        clauseId: clause.id,
        clauseName: clause.name,
        from,
        to: setting.value,
        label: setting.label,
        note: setting.note,
        pc: clause.costOf(from, setting.value),
        backlash: clause.backlash(from, setting.value),
      });
    }
  }
  return options;
}

/**
 * Amend the constitution. One per term, paid in political capital, and read by
 * every faction at once — self-serving amendments are the clearest signal a
 * government can send about what it is for.
 *
 * @returns {{ok: boolean, reason?: string, amendment?: object}}
 */
export function amend(game, clauseId, to, rng) {
  const constitution = constitutionOf(game);
  const clause = CLAUSES_BY_ID[clauseId];
  if (!clause) return { ok: false, reason: 'No such clause.' };
  if (amendmentsLeft(game) <= 0) {
    return { ok: false, reason: t('constitution.onePerTerm', 'One amendment per term. You have used yours.') };
  }
  const from = constitution[clauseId];
  if (from === to) return { ok: false, reason: 'That is already the position.' };

  const cost = clause.costOf(from, to);
  if (game.politicalCapital < cost) {
    return { ok: false, reason: t('constitution.needsCapital', 'Needs {n} political capital.', { n: cost }) };
  }

  const backlash = clause.backlash(from, to);
  game.politicalCapital -= cost;
  constitution[clauseId] = to;
  constitution.amendmentsUsed = (constitution.amendmentsUsed || 0) + 1;
  const amendment = {
    clauseId,
    from,
    to,
    term: game.term || 1,
    turn: game.turn,
    backlash,
  };
  constitution.amendments = [...(constitution.amendments || []), amendment];

  const player = game.nations[game.playerId];
  player.unrest = clamp(player.unrest + Math.max(0, backlash) * 0.4);
  player.stability = clamp(player.stability - Math.max(0, backlash) * 0.2 + Math.max(0, -backlash) * 0.3);
  player.approval = clamp(player.approval - backlash * 0.25);

  logEvent(game, {
    type: 'constitution',
    severity: 'critical',
    text: backlash > 8
      ? t('constitution.amendedSelfServing',
          '{nation} amends its constitution: {clause} becomes “{setting}”. Nobody is in any doubt about whom the change is for.',
          { nation: tNation(defOf(game, game.playerId)), clause: clause.name, setting: labelOf(clause, to) })
      : t('constitution.amended',
          '{nation} amends its constitution: {clause} becomes “{setting}”.',
          { nation: tNation(defOf(game, game.playerId)), clause: clause.name, setting: labelOf(clause, to) }),
    nations: [game.playerId],
  });

  return { ok: true, amendment };
}

function labelOf(clause, value) {
  return (clause.settings.find((s) => s.value === value) || {}).label || String(value);
}

// ── Terms and elections ─────────────────────────────────────────────────────

/** Whether the constitution would let you stand again at all. */
export function mayStandAgain(game) {
  const constitution = constitutionOf(game);
  const limit = constitution.termLimit;
  if (limit === 0) return true;
  return (game.term || 1) < limit;
}

/**
 * Whether the country would have you, and by how much.
 *
 * Approval carries it, the party machine turns it out, unrest bleeds it, and
 * the record you are running on counts for something — but not for as much as
 * people whose lives got worse.
 *
 * @returns {{share: number, won: boolean, reasons: Array<{label: string, value: number}>}}
 */
export function electionOutlook(game, score, factions = null) {
  const player = game.nations[game.playerId];
  const party = factions?.party?.mood ?? 50;
  const street = factions?.street?.mood ?? 50;

  const reasons = [
    { label: 'approval', value: (player.approval - 50) * 0.9 },
    { label: 'the streets', value: -(player.unrest - 40) * 0.45 },
    { label: 'your own party', value: (party - 50) * 0.3 },
    { label: 'the public mood', value: (street - 50) * 0.25 },
    { label: 'the record', value: ((score?.total ?? 50) - 55) * 0.35 },
    { label: 'the state of the country', value: (player.stability - 50) * 0.2 },
  ];

  const share = clamp(50 + reasons.reduce((sum, r) => sum + r.value, 0), 2, 96);
  return {
    share: Number(share.toFixed(1)),
    won: share >= 50,
    reasons: reasons
      .filter((r) => Math.abs(r.value) >= 0.5)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((r) => ({ ...r, value: Number(r.value.toFixed(1)) })),
  };
}

/** A word for how the vote is looking, before it is held. */
export function electionBand(share) {
  if (share >= 62) return { id: 'safe', label: 'comfortable' };
  if (share >= 52) return { id: 'likely', label: 'ahead' };
  if (share >= 48) return { id: 'knife', label: 'too close to call' };
  if (share >= 38) return { id: 'behind', label: 'behind' };
  return { id: 'lost', label: 'heading for defeat' };
}
