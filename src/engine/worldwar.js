// When a war stops being somebody's war.
//
// Every war was a private arrangement between two lists of countries. Two wars
// could run side by side with the same aggressor and the same victim's allies
// in both, and they stayed two wars with two front lines and two peace
// settlements. Blocs did nothing at all: NATO could watch a member be invaded
// with the treaty text sitting on the table, because only bilateral paper was
// ever read. And there was no state above "war" — no point at which the thing
// became general, and the world's economy, its neutrals and its arithmetic all
// changed character.
//
// Three mechanisms, in the order they fire:
//
//   1. The bloc answers. A military organisation whose member is attacked polls
//      the rest of its membership, weighted by the bloc's own cohesion.
//   2. Wars merge. If the same countries end up on the same sides of two
//      separate wars, it was one war and the map should say so.
//   3. The war goes general. Past a share of the world's power and a count of
//      great powers on both sides, it is promoted: it gets a name of its own,
//      trade collapses everywhere, neutrals are pressed to choose every
//      quarter, and belligerents mobilise whether or not they can afford to.

import { BLOCS } from '../data/nations.js';
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
import { theatreWeight } from './reach.js';

// ── 1. The bloc answers ─────────────────────────────────────────────────────

/** Organisations whose members expect each other to turn up with an army. */
const MILITARY_KINDS = new Set(['military']);

/**
 * A member of a military bloc has been attacked. Ask the rest of them.
 *
 * Polled once per war per member — a bloc that declined at the declaration does
 * not get asked again every quarter, which is what makes refusing it a decision
 * rather than a delay.
 *
 * @returns {Array<object>} report entries
 */
export function blocCall(game, war, rng) {
  if (!war.active) return [];
  const asked = war.blocAsked || (war.blocAsked = {});
  const reports = [];

  // Two passes. The defenders' organisations answer an attack on a member;
  // then, once they have, the *attacker's* organisations decide whether to
  // stand behind their own member now that a hostile alliance is in the field.
  // The second pass is what turns a war into a bipolar one, and it is the only
  // route by which the attacking side ever acquires a second great power.
  for (const side of ['defenders', 'attackers']) {
    const already = new Set([...war.attackers, ...war.defenders]);
    const enemies = side === 'defenders' ? war.attackers : war.defenders;
    // An alliance is not a hunting party: it backs an aggressor only after
    // somebody else's alliance has already come in against it.
    const counterMobilising = side === 'attackers';
    if (counterMobilising && !(war.blocJoiners || 0)) continue;

    // Only for the country that was actually attacked, plus anyone whose own
    // ground is under occupation. This is the difference between a mutual
    // defence clause and a chain letter: without it, every balancer who joined
    // a coalition brought its own organisations in behind it, and by the third
    // quarter half the world was a belligerent because somebody's friend's
    // friend had signed something.
    const triggers = new Set([war[side][0]]);
    for (const [, from] of war.occupied || []) {
      if (war[side].includes(from)) triggers.add(from);
    }

    for (const memberId of triggers) {
      if (!memberId || !isSovereign(game, memberId)) continue;
      for (const blocId of blocsOf(game, memberId)) {
        const bloc = BLOCS[blocId];
        if (!bloc || !MILITARY_KINDS.has(bloc.kind)) continue;
        const tag = `${war.id}:${blocId}`;
        if (asked[tag]) continue;
        asked[tag] = game.turn;

        const answered = [];
        for (const otherId of sovereignIds(game)) {
          if (already.has(otherId) || otherId === memberId) continue;
          if (!blocsOf(game, otherId).includes(blocId)) continue;

          // A bloc does not fight its own members.
          if (enemies.some((e) => blocsOf(game, e).includes(blocId))) continue;

          // Cohesion is the bloc's own credibility; the rest is how exposed the
          // member feels and how much the war would cost them.
          const risk = Math.max(...enemies.map((e) => combatPower(game, e)))
            / Math.max(1, combatPower(game, otherId));
          const chance = clamp(
            bloc.cohesion / (counterMobilising ? 240 : 152)
              + theatreWeight(game, otherId, war) * 0.2
              - Math.min(0.34, Math.log2(Math.max(1, risk)) * 0.14),
            0.03,
            0.85,
          );
          if (!rng.bool(chance)) continue;

          war[side].push(otherId);
          already.add(otherId);
          answered.push(otherId);
          for (const enemy of enemies) adjustRelation(game, otherId, enemy, -50);
          adjustRelation(game, otherId, memberId, 14);
        }

        if (!answered.length) continue;
        war.blocJoiners = (war.blocJoiners || 0) + answered.length;
        game.worldTension = clamp(game.worldTension + 6 + answered.length * 2, 0, 100);
        const text = t(counterMobilising ? 'war.blocCounter' : 'war.blocCall',
          counterMobilising
            ? '{bloc} mobilises behind {member} now that the other side has an alliance in the field. {list} enter the war.'
            : '{bloc} invokes its mutual defence clause for {member}. {list} enter the war.',
          {
            bloc: t(`bloc.${blocId}`, bloc.name),
            member: tNation(defOf(game, memberId)),
            list: answered.map((id) => tNation(defOf(game, id))).join(', '),
          });
        logEvent(game, { type: 'war', severity: 'critical', text, nations: [memberId, ...answered] });
        reports.push({
          type: 'bloc-call', warId: war.id, blocId,
          title: t('war.blocCallTitle', 'The Alliance Answers'), text, joined: answered,
        });
      }
    }
  }
  return reports;
}

// ── 2. Wars merge ───────────────────────────────────────────────────────────

/**
 * Two wars are the same war when nobody would have to fight on both sides.
 *
 * Requires an overlap on each side — a shared belligerent among the attackers
 * *and* among the defenders — so a country fighting two unrelated neighbours
 * does not have its wars welded together.
 */
function sameConflict(a, b) {
  const share = (x, y) => x.some((id) => y.includes(id));
  const straight = share(a.attackers, b.attackers) && share(a.defenders, b.defenders);
  const crossed = share(a.attackers, b.defenders) && share(a.defenders, b.attackers);
  if (!straight && !crossed) return null;
  if (straight && crossed) return null; // somebody would be on both sides
  const flip = crossed;
  const combinedA = [...new Set([...a.attackers, ...(flip ? b.defenders : b.attackers)])];
  const combinedD = [...new Set([...a.defenders, ...(flip ? b.attackers : b.defenders)])];
  if (combinedA.some((id) => combinedD.includes(id))) return null;
  return { attackers: combinedA, defenders: combinedD };
}

/**
 * Fold overlapping wars into one, largest first.
 * @returns {Array<object>} report entries
 */
export function mergeWars(game) {
  const reports = [];
  const active = () => game.wars.filter((w) => w.active);

  let merged = true;
  let guard = 0;
  while (merged && guard++ < 12) {
    merged = false;
    const wars = active().sort((a, b) => a.startTurn - b.startTurn);
    outer: for (let i = 0; i < wars.length; i++) {
      for (let j = i + 1; j < wars.length; j++) {
        const combined = sameConflict(wars[i], wars[j]);
        if (!combined) continue;
        const keep = wars[i];
        const drop = wars[j];

        keep.attackers = combined.attackers;
        keep.defenders = combined.defenders;
        keep.casualties += drop.casualties;
        keep.occupied = [...(keep.occupied || []), ...(drop.occupied || [])];
        keep.exhaustion.attackers = Math.max(keep.exhaustion.attackers, drop.exhaustion.attackers);
        keep.exhaustion.defenders = Math.max(keep.exhaustion.defenders, drop.exhaustion.defenders);
        keep.absorbedWars = [...(keep.absorbedWars || []), drop.name];
        drop.active = false;
        drop.endedTurn = game.turn;
        drop.outcome = 'Merged';
        drop.mergedInto = keep.id;

        const text = t('war.merged',
          'The {small} is no longer a separate war. It is a front of the {big}.',
          { small: drop.name, big: keep.name });
        logEvent(game, { type: 'war', severity: 'major', text, nations: [...combined.attackers, ...combined.defenders] });
        reports.push({ type: 'war-merge', warId: keep.id, title: t('war.mergedTitle', 'One War, Not Two'), text });
        merged = true;
        break outer;
      }
    }
  }
  return reports;
}

// ── 3. The war goes general ─────────────────────────────────────────────────

/** A country big enough that its entry changes the arithmetic. */
function isGreatPower(game, id) {
  return livePower(game, id) >= 118;
}

/**
 * How close this war is to being a general one, and what is missing.
 *
 * @returns {{share: number, powers: {attackers: number, defenders: number},
 *            belligerents: number, ready: boolean}}
 */
export function generalityOf(game, war) {
  const ids = sovereignIds(game);
  const worldPower = ids.reduce((sum, id) => sum + livePower(game, id), 0) || 1;
  const engaged = [...war.attackers, ...war.defenders].filter((id) => isSovereign(game, id));
  const share = engaged.reduce((sum, id) => sum + livePower(game, id), 0) / worldPower;
  const powers = {
    attackers: war.attackers.filter((id) => isGreatPower(game, id)).length,
    defenders: war.defenders.filter((id) => isGreatPower(game, id)).length,
  };
  return {
    share: Number(share.toFixed(3)),
    powers,
    belligerents: engaged.length,
    // Great powers on *both* sides. A coalition of everybody against one
    // middling aggressor is a police action, however many flags are on it —
    // what makes a war general is that both halves of it can fight.
    // A great power on each side and three between them. A coalition of
    // everybody against one middling aggressor is a police action however many
    // flags are on it; what makes a war general is that both halves can fight.
    ready: share >= WORLD_WAR_SHARE
      && powers.attackers >= 1 && powers.defenders >= 1
      && powers.attackers + powers.defenders >= 3
      && engaged.length >= 10,
  };
}

/** Share of world power that has to be in it before it is everybody's war. */
export const WORLD_WAR_SHARE = 0.36;

const GRAND_NAMES = [
  'The Great War',
  'The Second Great War',
  'The Third Great War',
  'The Fourth Great War',
];

function grandNameFor(game) {
  const used = game.wars.filter((w) => w.worldWar).length;
  if (used < GRAND_NAMES.length) return GRAND_NAMES[used];
  return t('war.worldWarOf', 'The World War of {year}', { year: game.year });
}

/**
 * Promote a war, then run the consequences of being in one.
 * @returns {Array<object>} report entries
 */
export function tickWorldWar(game, war, rng, mods) {
  const reports = [];
  if (!war.active) return reports;

  if (!war.worldWar) {
    const state = generalityOf(game, war);
    war.generality = state.share;
    if (!state.ready) return reports;

    war.worldWar = true;
    war.formerName = war.name;
    war.name = grandNameFor(game);
    war.declaredGeneralTurn = game.turn;
    game.worldWar = war.id;
    game.worldTension = 100;

    const text = t('war.wentGeneral',
      'What began as the {old} is now {new}. {n} states are belligerents and something over {pct}% of the world’s power is committed to one side or the other.',
      {
        old: war.formerName,
        new: war.name,
        n: state.belligerents,
        pct: Math.round(state.share * 100),
      });
    logEvent(game, { type: 'war', severity: 'critical', text, nations: [...war.attackers, ...war.defenders] });
    reports.push({ type: 'world-war', warId: war.id, title: t('war.wentGeneralTitle', 'A General War'), text });
  }

  // Everything below runs every quarter a general war is running.
  // Sea lanes, insurance and payment systems close for people who are not even
  // in it. This is the single biggest thing a world war does to a map.
  game.tradeShock = Math.min(0.75, (game.tradeShock || 0) + 0.16);

  // Total war is total: belligerents put the economy on the war footing whether
  // or not the treasury can carry it.
  for (const id of [...war.attackers, ...war.defenders]) {
    const state = game.nations[id];
    if (!state || !isSovereign(game, id)) continue;
    if (state.modifiers.some((m) => m.source === 'worldwar')) continue;
    addModifier(game, id, {
      label: t('war.warFooting', 'Total mobilisation'),
      turns: 8,
      growth: -0.55,
      unrest: 0.8,
      readiness: 1.4,
      source: 'worldwar',
    });
  }

  // And it gets very hard to stay out. Every quarter, one neutral is asked.
  const pressed = pressNeutral(game, war, rng, mods);
  if (pressed) reports.push(pressed);

  return reports;
}

/**
 * A general war does not leave anybody alone. Once a quarter one neutral is
 * put to the question: it joins whoever it is closer to, or it pays for
 * staying out in trade and standing.
 */
function pressNeutral(game, war, rng, mods) {
  const already = new Set([...war.attackers, ...war.defenders]);
  const neutrals = sovereignIds(game).filter((id) => !already.has(id));
  if (!neutrals.length) return null;

  const pick = rng.pick(neutrals);
  const def = defOf(game, pick);
  const state = game.nations[pick];
  if (!state) return null;

  const warmth = (side) =>
    side.reduce((sum, id) => sum + getRelation(game, pick, id), 0) / Math.max(1, side.length);
  const toAttackers = warmth(war.attackers);
  const toDefenders = warmth(war.defenders);
  const side = toDefenders >= toAttackers ? 'defenders' : 'attackers';
  const pull = Math.abs(toDefenders - toAttackers) / 100;

  const neutralist = (def.tags || []).some((tg) => /neutral|non-aligned|multi-aligned|bamboo/.test(tg))
    || (state.neutralUntil ?? 0) > game.turn;
  const chance = clamp(
    0.16 + pull * 0.5 + theatreWeight(game, pick, war) * 0.2 - (neutralist ? 0.18 : 0),
    0.03,
    0.75,
  ) * Math.min(1.6, mods?.aiAggression ?? 1);

  if (rng.bool(chance)) {
    war[side].push(pick);
    const enemies = side === 'defenders' ? war.attackers : war.defenders;
    for (const enemy of enemies) adjustRelation(game, pick, enemy, -50);
    const text = t('war.neutralJoins',
      '{nation} abandons neutrality and joins the {side} in {war}. There were, in the end, no good reasons left to stay out.',
      {
        nation: tNation(def),
        side: side === 'defenders'
          ? t('war.sideDefenders', 'defending coalition')
          : t('war.sideAttackers', 'attacking coalition'),
        war: war.name,
      });
    logEvent(game, { type: 'war', severity: 'major', text, nations: [pick] });
    return { type: 'neutral-joins', warId: war.id, title: t('war.neutralTitle', 'Neutrality Abandoned'), text, joinerId: pick };
  }

  // Staying out is also a decision, and it is charged for.
  state.influence = clamp(state.influence - 1.2);
  return null;
}

/** Everything the interface needs about the general war, or null. */
export function worldWarReport(game) {
  const war = game.wars.find((w) => w.worldWar && w.active);
  if (!war) {
    const past = game.wars.find((w) => w.worldWar);
    return past ? { war: past, over: true, state: generalityOf(game, past) } : null;
  }
  return { war, over: false, state: generalityOf(game, war) };
}

/**
 * How close the largest running war is to going general, for the panel that
 * warns a player before it does.
 */
export function brinkOfGeneralWar(game) {
  let worst = null;
  for (const war of game.wars) {
    if (!war.active || war.worldWar) continue;
    const state = generalityOf(game, war);
    if (!worst || state.share > worst.state.share) worst = { war, state };
  }
  if (!worst || worst.state.share < 0.13) return null;
  return worst;
}
