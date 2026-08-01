// The local briefing generator, and the local adjudicator for freeform orders.
//
// This is what makes the game fully playable with no API key. It reads exactly
// the same mechanical turn report a language model would, and its job is to be
// *specific*: real numbers, named causes, and the actual chain of consequences,
// rather than atmosphere. It will never be as varied as a model, but it should
// never be vaguer.

import { NATIONS, NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS, ACTIONS_BY_ID } from '../engine/actions.js';
import { describeChanges } from '../engine/effects.js';
import { playerLadders } from '../engine/consequences.js';
import { activeWarsFor, dateLabel, getRelation } from '../engine/state.js';
import { gameModifiers } from '../engine/worldmodes.js';

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

function joinList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

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

  const domestic = domesticParagraph(game, state);
  if (domestic) paragraphs.push(domestic);

  const world = worldParagraph(game, report);
  if (world) paragraphs.push(world);

  const war = warParagraph(game, report);
  if (war) paragraphs.push(war);

  // Dispatches: one per concrete thing that happened, attributed to a desk.
  for (const e of report.events.slice(0, 2)) {
    dispatches.push({ source: pick(OUTLETS, e.title.length + report.turn), text: e.text });
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
    return 'Your government issued no orders this quarter. The machinery of state ran on its own settings, which is a decision your opponents will read as one.';
  }

  const sentences = report.playerOutcomes.map((o) => {
    const target = o.targetId ? ` against ${NATIONS_BY_ID[o.targetId].name}` : '';
    const deltas = describeChanges(o.changes, game.playerId);
    const odds = `${Math.round(o.chance * 100)}%`;
    const detail = deltas.length ? ` Net effect at home: ${deltas.slice(0, 4).join(', ')}.` : '';
    const notes = o.notes?.length ? ` Ongoing: ${o.notes.join('; ')}.` : '';
    return `${o.actionName}${target} ${TIER_PHRASE[o.tier] || 'concluded'} — it was rated ${odds} beforehand and cost ${usd(o.cost)}.${detail}${notes}`;
  });

  return sentences.join(' ');
}

function chainParagraph(game, report) {
  const mine = report.consequences.filter((c) => c.involvesPlayer);
  if (!mine.length) return null;

  const inbound = mine.filter((c) => c.targetId === game.playerId);
  const lines = mine.slice(0, 4).map((c) => c.text);
  const extra = mine.length > 4 ? ` A further ${mine.length - 4} measures followed in the same week.` : '';

  const head = inbound.length >= 3
    ? 'The response was not proportionate, and it did not stop at one step. '
    : inbound.length
      ? 'It did not go unanswered. '
      : '';

  return `${head}${lines.join(' ')}${extra}`;
}

function economyParagraph(game, report, state) {
  const growth = report.economy?.playerGrowth ?? 0;
  const drivers = report.economy?.drivers || [];

  const headline = growth > 0.8
    ? 'The economy is running hot'
    : growth > 0.3
      ? 'The economy grew'
      : growth > 0
        ? 'The economy barely moved'
        : growth > -0.4
          ? 'The economy contracted'
          : 'The economy is in real trouble';

  const help = drivers.filter((d) => d.value > 0).slice(0, 2)
    .map((d) => `${d.label} (${d.value > 0 ? '+' : ''}${d.value})`);
  const hurt = drivers.filter((d) => d.value < 0).slice(0, 2)
    .map((d) => `${d.label} (${d.value})`);

  const because = help.length || hurt.length
    ? ` The gain came from ${joinList(help) || 'nothing in particular'}${hurt.length ? `, against a drag from ${joinList(hurt)}` : ''}.`
    : '';

  const books = `Revenue was ${usd(report.economy?.playerRevenue ?? 0)} against ${usd(report.economy?.playerUpkeep ?? 0)} of military upkeep.`;
  const purse = state.treasury < 0
    ? ` The treasury is ${usd(-state.treasury)} in the red and the bond desk has started returning calls late.`
    : ` ${usd(state.treasury)} is available for next quarter.`;

  return `${headline}: GDP moved ${growth >= 0 ? '+' : ''}${growth}% to $${state.gdp.toFixed(2)}T.${because} ${books}${purse}`;
}

function domesticParagraph(game, state) {
  const bits = [];
  if (state.unrest > 60) bits.push(`Unrest stands at ${Math.round(state.unrest)} and the security services are asking for instructions`);
  else if (state.unrest > 42) bits.push(`Unrest is elevated at ${Math.round(state.unrest)}`);

  if (state.stability < 40) bits.push(`stability has fallen to ${Math.round(state.stability)}, which is the range where governments stop being able to govern`);
  else if (state.stability < 55) bits.push(`stability sits at ${Math.round(state.stability)}`);

  if (state.approval < 35) bits.push(`approval is down to ${Math.round(state.approval)} and your own party has started briefing against you`);
  else if (state.approval > 70) bits.push(`approval is high at ${Math.round(state.approval)}, which is political capital you can actually spend`);

  const active = state.modifiers.filter((m) => (m.growth || 0) < 0).slice(0, 2).map((m) => m.label.toLowerCase());
  if (active.length) bits.push(`${joinList(active)} ${active.length > 1 ? 'are' : 'is'} still weighing on the books`);

  return bits.length ? `${bits.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) : null;
}

function worldParagraph(game, report) {
  const bits = report.events.slice(0, 3).map((e) => e.text);
  const notable = report.worldOutcomes.filter((o) => o.major && o.targetId !== game.playerId).slice(0, 3);
  for (const o of notable) {
    const target = o.targetId ? ` against ${NATIONS_BY_ID[o.targetId].name}` : '';
    bits.push(`${NATIONS_BY_ID[o.actorId].name} moved on ${o.actionName.toLowerCase()}${target}.`);
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
    return 'Nuclear weapons used in anger for the first time since 1945';
  }
  const warEnd = report.wars.find((w) => w.type === 'war-end');
  if (warEnd) return warEnd.text.split('.')[0];

  const mobilisation = report.consequences.find((c) => c.responseId === 'mobilisation' && c.involvesPlayer);
  if (mobilisation) return `${NATIONS_BY_ID[mobilisation.actorId].name} mobilises as the crisis with ${player.name} runs out of rungs`;

  const backfire = report.playerOutcomes.find((o) => o.tier === 'backfire');
  if (backfire) return `${player.adjective} government reeling as ${backfire.actionName.toLowerCase()} collapses`;

  const bigChain = report.consequences.filter((c) => c.involvesPlayer).length;
  if (bigChain >= 3) return `Retaliation against ${player.name} comes in waves, not notes`;

  const crit = report.playerOutcomes.find((o) => o.tier === 'critical');
  if (crit) return `${crit.actionName} lands better than anyone in ${player.name} expected`;

  if (report.decision && !report.decision.succeeded) return `${report.decision.title} handled badly`;
  if (report.events.length) return report.events[0].title;

  const growth = report.economy?.playerGrowth ?? 0;
  if (growth < -0.3) return `${player.name}'s economy contracts again`;
  if (game.worldTension > 78) return 'World tension climbs toward the top of the scale';
  return `${player.name} closes a quarter without incident`;
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
  return `World tension sits at ${Math.round(game.worldTension)}/100 going into ${dateLabel(game)}.`;
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
    .map((r) => NATIONS_BY_ID[r.id].name);

  const friends = Object.keys(game.nations)
    .filter((id) => id !== game.playerId)
    .map((id) => ({ id, rel: getRelation(game, game.playerId, id) }))
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 2)
    .map((r) => NATIONS_BY_ID[r.id].name);

  const weakest = ['stability', 'unrest', 'tech', 'influence', 'readiness']
    .map((key) => ({ key, value: key === 'unrest' ? 100 - state[key] : state[key] }))
    .sort((a, b) => a.value - b.value)[0];

  const weakness = {
    stability: 'your institutions are the fragile part of the machine',
    unrest: 'the streets are already restless',
    tech: 'your industrial base is behind the frontier',
    influence: 'nobody has to take your calls',
    readiness: 'your forces exist on paper more than in the field',
  }[weakest.key];

  return {
    headline: `You take office as ${player.leaderTitle} of ${player.name}`,
    briefing: [
      `${player.brief} You inherit a $${state.gdp.toFixed(2)}T economy and ${Math.round(state.population)} million people, ` +
        `with stability at ${Math.round(state.stability)}, unrest at ${Math.round(state.unrest)}, technology at ${Math.round(state.tech)} ` +
        `and ${usd(state.treasury)} you can actually spend this quarter.`,
      `Your closest relationships are with ${joinList(friends)}; your worst are with ${joinList(rivals)}. ` +
        `Of everything on your desk, ${weakness}.`,
      `The world runs at ${Math.round(game.worldTension)}/100 tension in ${mods.mode.name} on a ${mods.tier.name} setting. ` +
        `${mods.tier.blurb} You have ${game.totalTurns} quarters, and your mandate is to ` +
        `${joinList(game.objectives.map((o) => o.title.toLowerCase()))}.`,
    ],
    dispatches: [
      {
        source: 'Cabinet Office',
        text: `Transition complete. The ${player.leaderTitle.toLowerCase()}'s first orders are expected within the quarter.`,
      },
    ],
    advisorNote: 'First quarter sets the tone. Do one thing properly rather than four things badly.',
    outlook: 'Everything from here is your record.',
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
