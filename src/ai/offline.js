// The local briefing generator, and the local adjudicator for freeform orders.
//
// This is what makes the game fully playable with no API key. It reads exactly
// the same mechanical turn report a language model would, and its job is to be
// *specific*: real numbers, named causes, and the actual chain of consequences,
// rather than atmosphere. It will never be as varied as a model, but it should
// never be vaguer.

import { BLOCS, NATIONS, NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS, ACTIONS_BY_ID } from '../engine/actions.js';
import { describeChanges } from '../engine/effects.js';
import { playerLadders } from '../engine/consequences.js';
import { activeWarsFor, dateLabel, defOf, getRelation } from '../engine/state.js';
import { areaOf, startingAreaOf } from '../engine/territory.js';
import { gameModifiers } from '../engine/worldmodes.js';
import { t, tAction, tIn, tModifier, tNation } from '../i18n/index.js';

const OUTLETS = [
  'Reuters wire', 'Financial desk', 'Defence correspondent', 'Foreign ministry pool',
  'State broadcaster', 'Opposition press', 'Regional bureau', 'Trade desk',
  'Central bank watch', 'Security correspondent',
];

function pick(list, seed) {
  return list[Math.abs(Math.round(seed)) % list.length];
}

/** Billions in, a readable figure out. */
function usd(billions) {
  const v = Number(billions) || 0;
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${Math.round(v)}B`;
}

const TIER_PHRASE = {
  critical: 'went better than anyone had budgeted for',
  success: 'did what it was meant to do',
  partial: 'delivered part of what was promised',
  failure: 'failed',
  backfire: 'blew up in your government\'s face',
};

const tierPhrase = (tier) => t(`outcome.${tier}`, TIER_PHRASE[tier] || 'concluded');

function joinList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  const and = t('common.and', 'and');
  // Korean lists take a comma throughout rather than a trailing conjunction.
  if (and === ',') return items.join(', ');
  if (items.length === 2) return `${items[0]} ${and} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${and} ${items[items.length - 1]}`;
}

/**
 * Openers for each section, rotated by quarter. The local narrator will never
 * be as varied as a model, but it should not read like the same memo forty
 * times in a row either.
 */
/**
 * Openers for each section, rotated by quarter. The local narrator will never
 * be as varied as a model, but it should not read like the same memo forty
 * times in a row either.
 */
const OPENERS = {
  world: [
    ['elsewhere', 'Elsewhere:'],
    ['beyond', 'Beyond your borders:'],
    ['wires', 'On the wires this quarter:'],
    ['board', 'The rest of the board moved too:'],
    ['awayDesk', 'Away from your desk:'],
    ['wider', 'In the wider world:'],
  ],
  domestic: [
    ['home', 'At home,'],
    ['domestically', 'Domestically,'],
    ['inside', 'Inside the country,'],
    ['homeFront', 'On the home front,'],
    ['capital', 'In your own capital,'],
    ['frontPage', 'Behind the front page,'],
  ],
  map: [
    ['changed', 'The map itself changed:'],
    ['moved', 'Borders moved this quarter:'],
    ['ground', 'On the ground:'],
    ['shifted', 'The territorial position shifted:'],
    ['lines', 'Where the lines run now:'],
  ],
};

const opener = (kind, turn) => {
  const [id, english] = pick(OPENERS[kind], turn * 7 + kind.length);
  return t(`opener.${kind}.${id}`, english);
};

// ── The quarterly briefing ──────────────────────────────────────────────────

export function offlineBriefing(game, report) {
  const player = NATIONS_BY_ID[game.playerId];
  const state = game.nations[game.playerId];
  const paragraphs = [];
  const dispatches = [];

  paragraphs.push(ordersParagraph(game, report));

  const chain = chainParagraph(game, report);
  if (chain) paragraphs.push(chain);

  paragraphs.push(economyParagraph(game, report, state));

  const domestic = domesticParagraph(game, state, report.turn);
  if (domestic) paragraphs.push(domestic);

  const world = worldParagraph(game, report);
  if (world) paragraphs.push(world);

  const war = warParagraph(game, report);
  if (war) paragraphs.push(war);

  const borders = borderParagraph(game, report);
  if (borders) paragraphs.push(borders);

  const neighbourhood = neighbourhoodParagraph(game, report);
  if (neighbourhood) paragraphs.push(neighbourhood);

  const commerce = commerceParagraph(game, report);
  if (commerce) paragraphs.push(commerce);

  // Dispatches: one per concrete thing that happened, attributed to a desk.
  // An event that has an explanation carries it, because "why" is most of what
  // a desk is for.
  for (const e of report.events.slice(0, 3)) {
    dispatches.push({
      source: pick(OUTLETS, e.title.length + report.turn),
      text: e.cause
        ? `${e.text} ${t('brief.causeLine', 'Analysts point to {reason}.', { reason: e.cause.text })}`
        : e.text,
    });
  }
  for (const c of report.consequences.filter((x) => x.involvesPlayer).slice(0, 2)) {
    dispatches.push({ source: pick(OUTLETS, c.level + report.turn + 4), text: c.text });
  }
  for (const o of report.worldOutcomes.filter((x) => x.major).slice(0, 2)) {
    const target = o.targetId ? ` — aimed at ${NATIONS_BY_ID[o.targetId].name}` : '';
    dispatches.push({
      source: pick(OUTLETS, o.actionName.length + report.turn + 7),
      text: `${NATIONS_BY_ID[o.actorId].name}: ${o.actionName.toLowerCase()}${target}. ${o.tierLabel}.`,
    });
  }
  if (report.decision) dispatches.push({ source: 'Cabinet Office', text: report.decision.text });

  return {
    headline: buildHeadline(game, report),
    briefing: paragraphs.filter(Boolean),
    dispatches: dispatches.slice(0, 5),
    advisorNote: buildAdvice(game, report),
    outlook: buildOutlook(game, report),
  };
}

function ordersParagraph(game, report) {
  if (!report.playerOutcomes.length) {
    return t('brief.noOrders',
      'Your government issued no orders this quarter. The machinery of state ran on its own settings, which is a decision your opponents will read as one.');
  }

  const sentences = report.playerOutcomes.map((o) => {
    const target = o.targetId ? ` — ${tNation(NATIONS_BY_ID[o.targetId])}` : '';
    const deltas = describeChanges(o.changes, game.playerId);
    const line = t('brief.orderLine', '{action}{target} {outcome} — it was rated {odds} beforehand and cost {cost}.', {
      action: tAction({ id: o.actionId, name: o.actionName }),
      target,
      outcome: tierPhrase(o.tier),
      odds: `${Math.round(o.chance * 100)}%`,
      cost: usd(o.cost),
    });
    const detail = deltas.length
      ? t('brief.netEffect', ' Net effect at home: {deltas}.', { deltas: deltas.slice(0, 4).join(', ') })
      : '';
    const notes = o.notes?.length
      ? t('brief.ongoing', ' Ongoing: {notes}.', { notes: o.notes.join('; ') })
      : '';
    return `${line}${detail}${notes}`;
  });

  return sentences.join(' ');
}

function chainParagraph(game, report) {
  const mine = report.consequences.filter((c) => c.involvesPlayer);
  if (!mine.length) return null;

  const inbound = mine.filter((c) => c.targetId === game.playerId);
  // The same measure can be taken by several actors in one week; saying it
  // twice reads like a bug rather than like emphasis.
  const lines = [...new Set(mine.map((c) => c.text))];
  const shown = lines.slice(0, 4);
  const left = lines.length - shown.length;
  const extra = left > 1
    ? t('brief.moreMeasures', ' A further {n} measures followed in the same week.', { n: left })
    : left === 1
      ? t('brief.oneMoreMeasure', ' One more measure followed in the same week.')
      : '';

  const head = inbound.length >= 3
    ? t('brief.notProportionate', 'The response was not proportionate, and it did not stop at one step. ')
    : inbound.length
      ? t('brief.answered', 'It did not go unanswered. ')
      : '';

  return `${head}${shown.join(' ')}${extra}`;
}

function economyParagraph(game, report, state) {
  const growth = report.economy?.playerGrowth ?? 0;
  const drivers = report.economy?.drivers || [];

  const headline = growth > 0.8
    ? t('brief.econHot', 'The economy is running hot')
    : growth > 0.3
      ? t('brief.econGrew', 'The economy grew')
      : growth > 0
        ? t('brief.econFlat', 'The economy barely moved')
        : growth > -0.4
          ? t('brief.econShrank', 'The economy contracted')
          : t('brief.econBad', 'The economy is in real trouble');

  const driverName = (d) => t(`driver.${d.label}`, d.label);
  const help = drivers.filter((d) => d.value > 0).slice(0, 2)
    .map((d) => `${driverName(d)} (+${d.value})`);
  const hurt = drivers.filter((d) => d.value < 0).slice(0, 2)
    .map((d) => `${driverName(d)} (${d.value})`);

  const because = help.length || hurt.length
    ? t('brief.because', ' The gain came from {help}{drag}.', {
        help: joinList(help) || t('brief.nothingParticular', 'nothing in particular'),
        drag: hurt.length ? t('brief.against', ', against a drag from {hurt}', { hurt: joinList(hurt) }) : '',
      })
    : '';

  const books = t('brief.revenueLine', 'Revenue was {revenue} against {upkeep} of military upkeep.', {
    revenue: usd(report.economy?.playerRevenue ?? 0),
    upkeep: usd(report.economy?.playerUpkeep ?? 0),
  });
  const purse = state.treasury < 0
    ? t('brief.inTheRed', ' The treasury is {amount} in the red and the bond desk has started returning calls late.', { amount: usd(-state.treasury) })
    : t('brief.availableNext', ' {amount} is available for next quarter.', { amount: usd(state.treasury) });

  const stem = t('brief.gdpMoved', '{headline}: GDP moved {growth}% to ${gdp}T.', {
    headline,
    growth: `${growth >= 0 ? '+' : ''}${growth}`,
    gdp: state.gdp.toFixed(2),
  });
  return `${stem}${because} ${books}${purse}`;
}

function domesticParagraph(game, state, turn = 0) {
  const bits = [];
  if (state.unrest > 60) bits.push(t('brief.unrestHigh', 'Unrest stands at {n} and the security services are asking for instructions', { n: Math.round(state.unrest) }));
  else if (state.unrest > 42) bits.push(t('brief.unrestMid', 'Unrest is elevated at {n}', { n: Math.round(state.unrest) }));

  if (state.stability < 40) bits.push(t('brief.stabLow', 'stability has fallen to {n}, which is the range where governments stop being able to govern', { n: Math.round(state.stability) }));
  else if (state.stability < 55) bits.push(t('brief.stabMid', 'stability sits at {n}', { n: Math.round(state.stability) }));

  if (state.approval < 35) bits.push(t('brief.approvalLow', 'approval is down to {n} and your own party has started briefing against you', { n: Math.round(state.approval) }));
  else if (state.approval > 70) bits.push(t('brief.approvalHigh', 'approval is high at {n}, which is political capital you can actually spend', { n: Math.round(state.approval) }));

  const active = [...new Set(
    state.modifiers.filter((m) => (m.growth || 0) < 0).map((m) => tModifier(m.label)),
  )].slice(0, 2);
  if (active.length) bits.push(t('brief.weighing', '{list} is still weighing on the books', { list: joinList(active) }));

  return bits.length ? `${opener('domestic', turn)} ${bits.join('; ')}.` : null;
}

function worldParagraph(game, report) {
  const bits = report.events.slice(0, 4).map((e) => (
    e.cause
      ? `${e.text} ${t('brief.causeLine', 'Analysts point to {reason}.', { reason: e.cause.text })}`
      : e.text
  ));
  const notable = report.worldOutcomes.filter((o) => o.major && o.targetId !== game.playerId).slice(0, 3);
  for (const o of notable) {
    const target = o.targetId ? ` → ${tNation(defOf(game, o.targetId))}` : '';
    bits.push(`${tNation(defOf(game, o.actorId))}: ${tAction({ id: o.actionId, name: o.actionName })}${target}.`);
  }
  return bits.length ? `${opener('world', report.turn)} ${bits.join(' ')}` : null;
}

/**
 * What happened to the map: ground taken, states created, alliances changed.
 * This is the paragraph that makes a border on the situation map mean something
 * when the player looks up at it.
 */
function borderParagraph(game, report) {
  const bits = [];

  for (const w of report.wars) {
    if (w.ground) {
      bits.push(t('brief.groundMoved', '{a} took roughly {n},000 km² from {b}.', {
        a: tNation(defOf(game, w.ground.to)),
        b: tNation(defOf(game, w.ground.from)),
        n: w.ground.area,
      }));
    }
    if (w.annexed) {
      bits.push(t('brief.annexed', 'The settlement leaves {n} occupied districts on the winning side of the new line.', { n: w.annexed }));
    }
  }

  for (const e of report.events) {
    if (e.outcome?.def) {
      bits.push(t('brief.newState', '{child} now exists, carved out of {parent} — {pct}% of its land and a claim on more.', {
        child: tNation(e.outcome.def),
        parent: tNation(defOf(game, e.outcome.def.parentId)),
        pct: Math.round(e.outcome.share * 100),
      }));
    }
  }

  const mine = areaOf(game, game.playerId);
  const start = startingAreaOf(game, game.playerId);
  if (start > 0) {
    const drift = ((mine - start) / start) * 100;
    if (Math.abs(drift) >= 2) {
      bits.push(drift > 0
        ? t('brief.landGained', 'You now hold {pct}% more ground than you did on the day you took office.', { pct: drift.toFixed(0) })
        : t('brief.landLost', 'You now hold {pct}% less ground than you did on the day you took office.', { pct: Math.abs(drift).toFixed(0) }));
    }
  }

  return bits.length ? `${opener('map', report.turn)} ${bits.join(' ')}` : null;
}

/** Who changed sides, and whether it happened next to you. */
function neighbourhoodParagraph(game, report) {
  const changes = report.realignments || [];
  if (!changes.length) return null;
  const lines = changes.slice(0, 3).map((c) => (
    c.joined
      ? t('brief.joined', '{nation} joined {bloc}.', {
          nation: tNation(defOf(game, c.id)),
          bloc: t(`bloc.${c.blocId}`, BLOCS[c.blocId]?.name || c.blocId),
        })
      : t('brief.left', '{nation} walked out of {bloc}.', {
          nation: tNation(defOf(game, c.id)),
          bloc: t(`bloc.${c.blocId}`, BLOCS[c.blocId]?.name || c.blocId),
        })
  ));
  const more = changes.length > 3
    ? ` ${t('brief.moreRealignments', '{n} other governments quietly did the same.', { n: changes.length - 3 })}`
    : '';
  return `${lines.join(' ')}${more}`;
}

/**
 * The quarter's commerce and correspondence: what closed, what re-opened, and
 * what other governments said back to you.
 */
function commerceParagraph(game, report) {
  const bits = [];

  if (report.worldWar && !report.worldWar.over) {
    bits.push(t('brief.general',
      'The {war} is now a general war. Shipping insurance has doubled, payment systems are closing to whole regions, and the countries not in it are being asked every week why not.',
      { war: report.worldWar.war.name }));
  } else if (report.brink) {
    bits.push(t('brief.brink',
      '{pct}% of the world’s power is now committed to the {war}. Nobody in the building will say the word, but everybody is thinking it.',
      { pct: Math.round(report.brink.state.share * 100), war: report.brink.war.name }));
  }

  const health = report.tradeHealth ?? 1;
  if (health < 0.94) {
    bits.push(t('brief.tradeHealth',
      'Only {pct}% of your foreign commercial arrangements are running. The rest are shut, and the growth figures above already reflect it.',
      { pct: Math.round(health * 100) }));
  }

  for (const entry of (report.exchanges || []).slice(0, 2)) {
    if (entry.text) bits.push(entry.text);
  }

  return bits.length ? bits.join(' ') : null;
}

function warParagraph(game, report) {
  const bits = report.wars.map((w) => w.text).filter(Boolean);
  const wars = activeWarsFor(game, game.playerId);
  for (const war of wars) {
    const attacking = war.attackers.includes(game.playerId);
    const score = attacking ? war.warScore : -war.warScore;
    const exhaustion = attacking ? war.exhaustion.attackers : war.exhaustion.defenders;
    bits.push(
      `In the ${war.name} you are ${score > 10 ? 'ahead' : score < -10 ? 'behind' : 'deadlocked'} ` +
      `(${Math.round(score)} on a scale of a hundred), war weariness is at ${Math.round(exhaustion)}, ` +
      `and the war has cost roughly ${(war.casualties / 1000).toFixed(0)} thousand casualties so far.`,
    );
  }
  return bits.length ? bits.join(' ') : null;
}

function buildHeadline(game, report) {
  const player = NATIONS_BY_ID[game.playerId];

  if (report.wars.some((w) => w.type === 'nuclear')) {
    return t('head.nuclear', 'Nuclear weapons used in anger for the first time since 1945');
  }
  const general = report.wars.find((w) => w.type === 'world-war');
  if (general) return t('head.general', 'It is a general war now');
  const warEnd = report.wars.find((w) => w.type === 'war-end');
  if (warEnd) return warEnd.text.split('.')[0];
  const blocAnswer = report.wars.find((w) => w.type === 'bloc-call');
  if (blocAnswer) return blocAnswer.text.split('.')[0];

  const nation = tNation(player);

  const mobilisation = report.consequences.find((c) => c.responseId === 'mobilisation' && c.involvesPlayer);
  if (mobilisation) {
    return t('head.mobilisation', '{other} mobilises as the crisis with {nation} runs out of rungs',
      { other: tNation(NATIONS_BY_ID[mobilisation.actorId]), nation });
  }

  const backfire = report.playerOutcomes.find((o) => o.tier === 'backfire');
  if (backfire) {
    return t('head.backfire', 'Government reeling as {action} collapses',
      { action: tAction({ id: backfire.actionId, name: backfire.actionName }), nation });
  }

  if (report.consequences.filter((c) => c.involvesPlayer).length >= 3) {
    return t('head.waves', 'Retaliation against {nation} comes in waves, not notes', { nation });
  }

  const crit = report.playerOutcomes.find((o) => o.tier === 'critical');
  if (crit) {
    return t('head.critical', '{action} lands better than anyone expected',
      { action: tAction({ id: crit.actionId, name: crit.actionName }), nation });
  }

  if (report.decision && !report.decision.succeeded) {
    return t('head.badDecision', '{title} handled badly', { title: report.decision.title });
  }
  if (report.events.length) return t(`eventTitle.${report.events[0].eventId}`, report.events[0].title);

  const growth = report.economy?.playerGrowth ?? 0;
  if (growth < -0.3) return t('head.contracting', "{nation}'s economy contracts again", { nation });
  if (game.worldTension > 78) return t('head.tension', 'World tension climbs toward the top of the scale');
  return t('head.quiet', '{nation} closes a quarter without incident', { nation });
}

function buildAdvice(game, report) {
  const state = game.nations[game.playerId];
  const mods = gameModifiers(game);
  const ladders = playerLadders(game);
  const hottest = ladders[0];

  if (game.stats.nukesUsed > 0) return 'A nuclear weapon has been used. Nothing you planned before this quarter still applies.';
  if (state.stability < 30) return 'We are close to losing the ability to govern. Everything else can wait.';
  if (state.treasury < 0) return `We are ${usd(-state.treasury)} in the red. Consolidate now, or the markets will do it for us.`;
  if (hottest && hottest.value >= 8.5) {
    return `The ladder with ${NATIONS_BY_ID[hottest.id].name} has one rung left. Either climb down or be ready for what is at the top.`;
  }
  if (state.unrest > 65) return 'The streets are the problem now, not the neighbours. Fix that first.';
  if (hottest && hottest.value >= 6) {
    return `${NATIONS_BY_ID[hottest.id].name} is answering every move now, and answering bigger. Another push will not stay bilateral.`;
  }
  if (activeWarsFor(game, game.playerId).length) return 'We are at war. Every quarter it continues costs more than the last.';
  if (state.approval < 35) return 'Approval this low means we cannot pass anything. Buy some back before attempting reform.';
  if (game.worldTension > 70) return 'The world is one incident away from something none of us control. Keep a channel open.';
  if (state.treasury > state.gdp * 130) return 'We are sitting on reserves that buy nothing while they sit. Deploy them.';
  if (mods.level >= 8) return 'Everyone is moving against us at once. Pick the fight you can win and ignore the rest.';
  if (!report.playerOutcomes.length) return 'A quarter with no orders is a quarter your rivals got for free.';
  return 'Quiet quarters are when position gets built. Spend the calm on something that compounds.';
}

function buildOutlook(game, report) {
  if (report.newDecision) return `${report.newDecision.title} is on your desk and will not wait.`;
  const ladders = playerLadders(game).filter((l) => l.value >= 3.5);
  if (ladders.length) {
    return `Escalation with ${joinList(ladders.slice(0, 2).map((l) => `${NATIONS_BY_ID[l.id].name} (${l.label.toLowerCase()})`))} is the thing to watch.`;
  }
  return t('brief.tensionOutlook', 'World tension sits at {tension}/100 going into {date}.',
    { tension: Math.round(game.worldTension), date: dateLabel(game) });
}

// ── The opening report ──────────────────────────────────────────────────────

export function offlineOpening(game) {
  const player = NATIONS_BY_ID[game.playerId];
  const state = game.nations[game.playerId];
  const mods = gameModifiers(game);

  const rivals = Object.keys(game.nations)
    .filter((id) => id !== game.playerId)
    .map((id) => ({ id, rel: getRelation(game, game.playerId, id) }))
    .sort((a, b) => a.rel - b.rel)
    .slice(0, 2)
    .map((r) => tNation(NATIONS_BY_ID[r.id]));

  const friends = Object.keys(game.nations)
    .filter((id) => id !== game.playerId)
    .map((id) => ({ id, rel: getRelation(game, game.playerId, id) }))
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 2)
    .map((r) => tNation(NATIONS_BY_ID[r.id]));

  const weakest = ['stability', 'unrest', 'tech', 'influence', 'readiness']
    .map((key) => ({ key, value: key === 'unrest' ? 100 - state[key] : state[key] }))
    .sort((a, b) => a.value - b.value)[0];

  const weakness = t(`open.weak.${weakest.key}`, {
    stability: 'your institutions are the fragile part of the machine',
    unrest: 'the streets are already restless',
    tech: 'your industrial base is behind the frontier',
    influence: 'nobody has to take your calls',
    readiness: 'your forces exist on paper more than in the field',
  }[weakest.key]);

  return {
    headline: t('open.headline', 'You take office as {title} of {nation}', {
      title: tNation(player, 'leaderTitle'),
      nation: tNation(player),
    }),
    briefing: [
      t('open.p1', '{brief} You inherit a ${gdp}T economy and {pop} million people, with stability at {stability}, unrest at {unrest}, technology at {tech} and {treasury} you can actually spend this quarter.', {
        brief: tNation(player, 'brief'),
        gdp: state.gdp.toFixed(2),
        pop: Math.round(state.population),
        stability: Math.round(state.stability),
        unrest: Math.round(state.unrest),
        tech: Math.round(state.tech),
        treasury: usd(state.treasury),
      }),
      t('open.p2', 'Your closest relationships are with {friends}; your worst are with {rivals}. Of everything on your desk, {weakness}.', {
        friends: joinList(friends),
        rivals: joinList(rivals),
        weakness,
      }),
      t('open.p3', 'The world runs at {tension}/100 tension in {mode} on a {tier} setting. {blurb} You have {turns} quarters, and your mandate is to {objectives}.', {
        tension: Math.round(game.worldTension),
        mode: t(`mode.${mods.mode.id}`, mods.mode.name),
        tier: t(`tierName.${mods.tier.name}`, mods.tier.name),
        blurb: tIn('tiers', mods.tier.name, 'blurb', mods.tier.blurb),
        turns: game.totalTurns,
        objectives: joinList(game.objectives.map((o) => t(`objective.${o.id}.title`, o.title))),
      }),
    ],
    dispatches: [
      {
        source: t('open.cabinetOffice', 'Cabinet Office'),
        text: t('open.transition', 'Transition complete. The first orders are expected within the quarter.'),
      },
    ],
    advisorNote: t('open.advice', 'First quarter sets the tone. Do one thing properly rather than four things badly.'),
    outlook: t('open.outlook', 'Everything from here is your record.'),
  };
}

// ── Local adjudication of freeform orders ───────────────────────────────────

/**
 * Intent matching for the freeform box. Without a language model we cannot
 * *understand* the order, but we can recognise what it is closest to in the
 * catalogue, which is far better than pricing everything as a generic
 * diplomatic initiative.
 */
const INTENTS = [
  { id: 'sanctions', strong: ['sanction', 'embargo', 'blockade', 'blacklist'], words: ['sanction', 'embargo', 'tariff', 'blacklist', 'freeze asset', 'cut off trade', 'trade war', 'export ban', 'blockade'] },
  { id: 'trade-deal', strong: ['trade deal', 'trade agreement', 'free trade', 'offtake'], words: ['trade deal', 'trade agreement', 'free trade', 'market access', 'tariff cut', 'commercial treaty', 'export deal', 'buy', 'contract', 'offtake', 'supply deal'] },
  { id: 'stimulus', strong: ['stimulus', 'bailout', 'tax cut'], words: ['stimulus', 'spend', 'inject', 'cash', 'boost the economy', 'tax cut', 'bailout', 'demand'] },
  { id: 'infrastructure', strong: ['infrastructure', 'railway', 'highway'], words: ['infrastructure', 'railway', 'port', 'grid', 'highway', 'bridge', 'build out', 'construction', 'housing'] },
  { id: 'industrial-policy', strong: ['industrial policy', 'subsid', 'shipbuild'], words: ['industrial', 'subsid', 'factory', 'manufactur', 'steel', 'shipbuild', 'battery', 'domestic industry'] },
  { id: 'energy-security', strong: ['energy security', 'pipeline', 'lng'], words: ['energy', 'oil', 'gas', 'pipeline', 'lng', 'nuclear power', 'renewable', 'solar', 'wind', 'reserves'] },
  { id: 'austerity', strong: ['austerity', 'budget cut', 'balance the budget'], words: ['austerity', 'cut spending', 'budget cut', 'balance the budget', 'fiscal discipline', 'raise taxes'] },
  { id: 'rearm', strong: ['rearm', 'rearmament', 'defence budget', 'defense budget', 'procure'], words: ['rearm', 'buy weapons', 'military buildup', 'build up the army', 'procure', 'tanks', 'jets', 'warship', 'missile', 'defence budget', 'defense budget'] },
  { id: 'exercises', strong: ['exercise', 'drill', 'war game', 'show of force'], words: ['exercise', 'drill', 'manoeuvre', 'maneuver', 'war game', 'show of force', 'parade'] },
  { id: 'forward-deploy', strong: ['deploy', 'station troops', 'garrison'], words: ['deploy', 'station troops', 'base', 'send forces', 'carrier', 'garrison', 'position forces'] },
  { id: 'arms-transfer', strong: ['arms transfer', 'send weapons', 'supply weapons', 'lend-lease', 'military aid'], words: ['arm them', 'send weapons', 'arms transfer', 'military aid', 'supply weapons', 'ship arms', 'lend-lease'] },
  { id: 'intervene', strong: ['invade', 'declare war', 'military intervention', 'occupy'], words: ['invade', 'attack', 'declare war', 'military intervention', 'strike them', 'bomb', 'occupy'] },
  { id: 'seek-peace', strong: ['ceasefire', 'armistice', 'end the war', 'truce'], words: ['peace', 'ceasefire', 'armistice', 'end the war', 'negotiate a settlement', 'truce'] },
  { id: 'nuclear-programme', strong: ['nuclear weapon', 'the bomb', 'warhead', 'go nuclear'], words: ['nuclear weapon', 'the bomb', 'warhead', 'enrich', 'nuclear deterrent', 'go nuclear'] },
  { id: 'state-visit', strong: ['state visit', 'summit', 'state dinner'], words: ['visit', 'summit', 'meet', 'talks', 'handshake', 'delegation', 'state dinner'] },
  { id: 'defence-pact', strong: ['defence pact', 'defense pact', 'mutual defence', 'security guarantee', 'alliance'], words: ['alliance', 'defence pact', 'defense pact', 'mutual defence', 'security guarantee', 'treaty of'] },
  { id: 'aid-package', strong: ['humanitarian', 'foreign aid', 'relief'], words: ['aid', 'humanitarian', 'relief', 'development assistance', 'donate', 'grant', 'famine'] },
  { id: 'multilateral', strong: ['multilateral', 'united nations', 'coalition'], words: ['united nations', 'multilateral', 'coalition', 'international', 'convene', 'summit of', 'g7', 'g20', 'bloc'] },
  { id: 'mediate', strong: ['mediate', 'broker', 'de-escalate', 'deescalate'], words: ['mediate', 'broker', 'peace talks', 'go between', 'de-escalate', 'deescalate'] },
  { id: 'condemn', strong: ['condemn', 'denounce'], words: ['condemn', 'denounce', 'criticise', 'criticize', 'call out', 'statement against', 'protest'] },
  { id: 'crackdown', strong: ['crackdown', 'martial law', 'curfew', 'suppress'], words: ['crackdown', 'suppress', 'martial law', 'arrest', 'riot police', 'curfew', 'censor'] },
  { id: 'reform', strong: ['anti-corruption', 'judiciary', 'civil service', 'rule of law', 'reform'], words: ['reform', 'anti-corruption', 'judiciary', 'civil service', 'institution', 'constitution', 'rule of law'] },
  { id: 'social-spending', strong: ['welfare', 'pension', 'social spending', 'healthcare'], words: ['welfare', 'pension', 'wages', 'subsidy for people', 'healthcare', 'school', 'social spending', 'benefits'] },
  { id: 'messaging', strong: ['propaganda', 'messaging campaign', 'public relations'], words: ['propaganda', 'messaging', 'campaign', 'narrative', 'media', 'public relations', 'speech'] },
  { id: 'mandate', strong: ['referendum', 'snap poll', 'mandate', 'election'], words: ['election', 'referendum', 'mandate', 'go to the country', 'snap poll'] },
  { id: 'espionage', strong: ['espionage', 'spy', 'infiltrate', 'industrial secret'], words: ['spy', 'steal', 'espionage', 'industrial secret', 'intelligence on', 'infiltrate'] },
  { id: 'cyber-op', strong: ['cyber', 'hack', 'malware', 'ransomware', 'ddos'], words: ['cyber', 'hack', 'malware', 'ransomware', 'network attack', 'digital', 'take down their'] },
  { id: 'destabilise', strong: ['destabilise', 'destabilize', 'coup', 'regime change', 'overthrow', 'fund the opposition'], words: ['destabilise', 'destabilize', 'coup', 'fund the opposition', 'regime change', 'insurgen', 'overthrow'] },
  { id: 'counter-intel', strong: ['counter-intelligence', 'counterintelligence', 'security sweep'], words: ['counter-intelligence', 'counterintelligence', 'mole', 'security sweep', 'root out spies'] },
  { id: 'rnd-push', strong: ['research', 'r&d', 'laborator'], words: ['research', 'r&d', 'science', 'laborator', 'university', 'innovation'] },
  { id: 'compute-programme', strong: ['artificial intelligence', 'datacent', 'supercomputer', 'compute'], words: ['ai ', 'artificial intelligence', 'compute', 'datacent', 'gpu', 'supercomputer', 'model training'] },
  { id: 'space-programme', strong: ['space programme', 'space program', 'satellite', 'rocket', 'orbit'], words: ['space', 'satellite', 'rocket', 'launch vehicle', 'orbit', 'moon'] },
  { id: 'semiconductors', strong: ['semiconductor', 'fab', 'lithograph', 'foundry', 'wafer'], words: ['semiconductor', 'chip', 'fab', 'lithograph', 'foundry', 'wafer'] },
];

const AMBITION_UP = ['massive', 'total', 'full-scale', 'nationwide', 'immediately', 'all-out', 'maximum', 'every', 'huge', 'crash programme', 'crash program', 'double'];
const AMBITION_DOWN = ['quietly', 'quiet', 'small', 'limited', 'modest', 'trial', 'pilot', 'discreet', 'token', 'slowly'];

/** Find the country an order is talking about, if any. */
function detectTarget(game, text) {
  const lower = ` ${text.toLowerCase()} `;
  let best = null;
  for (const def of NATIONS) {
    if (def.id === game.playerId) continue;
    for (const term of [def.name, def.adjective]) {
      const needle = term.toLowerCase();
      const at = lower.indexOf(needle);
      if (at === -1) continue;
      // Prefer the longest match, so "South Korea" beats "Korea".
      if (!best || needle.length > best.length) best = { id: def.id, length: needle.length };
    }
  }
  return best?.id ?? null;
}

function scoreIntent(intent, lower) {
  let score = 0;
  // A decisive keyword ("hack", "embargo") must beat an incidental one
  // ("missile" appearing inside a cyber order).
  for (const word of intent.strong || []) {
    if (lower.includes(word)) score += 6;
  }
  for (const word of intent.words) {
    if (lower.includes(word)) score += word.length > 8 ? 2 : 1;
  }
  return score;
}

/**
 * Price a freeform order without a language model.
 * @returns {object} the same shape the AI adjudicator returns
 */
export function offlineAdjudication(game, orderText) {
  const text = String(orderText || '').trim();
  const lower = ` ${text.toLowerCase()} `;
  const name = text.length > 58 ? `${text.slice(0, 55)}…` : text || 'Freeform order';

  const ranked = INTENTS
    .map((intent) => ({ intent, score: scoreIntent(intent, lower) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const match = ranked[0];
  let base = match ? ACTIONS_BY_ID[match.intent.id] : null;
  const targetId = detectTarget(game, text);

  // Talking peace only maps to suing for peace if there is a war to end;
  // otherwise it is diplomacy, and should be priced as diplomacy.
  if (base?.requiresWar) {
    const atWar = game.wars.some(
      (w) => w.active
        && ((w.attackers.includes(game.playerId) && w.defenders.includes(targetId))
          || (w.defenders.includes(game.playerId) && w.attackers.includes(targetId))),
    );
    if (!atWar) base = targetId ? ACTIONS_BY_ID['state-visit'] : ACTIONS_BY_ID.mediate;
  }

  if (!base) {
    return {
      feasible: true,
      targetId,
      source: 'offline',
      rationale:
        'Your staff could not tie this to any specific instrument, so it was costed as a general-purpose initiative. ' +
        'Naming a concrete lever — sanctions, a trade deal, an exercise, a research programme — gets it priced properly. ' +
        'Configuring a free AI provider in Settings lets orders be read rather than pattern-matched.',
      refusal: null,
      action: {
        id: 'custom-order',
        name,
        category: 'diplomacy',
        blurb: 'Freeform order, matched locally.',
        cost: { pctGdp: 0.6 },
        pc: 2,
        target: targetId ? 'nation' : 'none',
        baseSuccess: 0.5,
        risk: 'medium',
        skills: [['influence', 0.15], ['stability', 0.1]],
        effects: {
          success: { self: { influence: 2, approval: 2 } },
          failure: { self: { approval: -2 } },
        },
      },
    };
  }

  // Ambition words move the price and the odds in opposite directions.
  const up = AMBITION_UP.filter((w) => lower.includes(w)).length;
  const down = AMBITION_DOWN.filter((w) => lower.includes(w)).length;
  const scale = Math.max(0.5, Math.min(2, 1 + up * 0.35 - down * 0.25));

  const needsTarget = base.target === 'nation';
  const action = {
    ...base,
    id: 'custom-order',
    name,
    blurb: `Matched to ${base.name.toLowerCase()}.`,
    cost: {
      pctGdp: Number(((base.cost?.pctGdp || 0) * scale).toFixed(2)),
      flat: (base.cost?.flat || 0) * scale,
    },
    pc: Math.max(1, Math.min(5, Math.round((base.pc || 2) * (scale > 1.2 ? 1.4 : 1)))),
    target: needsTarget && targetId ? 'nation' : 'none',
    baseSuccess: Math.max(0.12, Math.min(0.88, (base.baseSuccess || 0.6) - (scale - 1) * 0.18)),
  };

  const targetNote = needsTarget
    ? targetId
      ? ` Directed at ${NATIONS_BY_ID[targetId].name}.`
      : ' No country was named, so it is costed as a general programme rather than a targeted one.'
    : '';
  const scaleNote = scale > 1.15
    ? ' The scale you described raises the price and lowers the odds.'
    : scale < 0.9
      ? ' Keeping it small makes it cheaper and more likely to come off.'
      : '';

  return {
    feasible: true,
    targetId: needsTarget ? targetId : null,
    source: 'offline',
    rationale: `Your staff read this as ${base.name.toLowerCase()}.${targetNote}${scaleNote}`,
    refusal: null,
    action,
  };
}

export { ACTIONS };
