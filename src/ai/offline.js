// Local briefing generator. This is what makes the game playable with no API
// key at all: it reads the same mechanical report the model would and writes a
// serviceable, if less varied, briefing from it.

import { NATIONS_BY_ID } from '../data/nations.js';
import { difficultyModifiers } from '../engine/difficulty.js';
import { dateLabel } from '../engine/state.js';

const OUTLETS = [
  'Reuters wire', 'Financial desk', 'Defence correspondent', 'Foreign ministry pool',
  'State broadcaster', 'Opposition press', 'Regional bureau', 'Trade desk',
];

function pick(list, seed) {
  return list[Math.abs(seed) % list.length];
}

/** Billions in, a readable figure out. */
function usd(billions) {
  const v = Number(billions) || 0;
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${Math.round(v)}B`;
}

function toneWord(tier) {
  switch (tier) {
    case 'critical': return 'exceeded every expectation set for it';
    case 'success': return 'achieved what it set out to do';
    case 'partial': return 'delivered part of what was promised';
    case 'failure': return 'failed';
    case 'backfire': return 'blew up in your government\'s face';
    default: return 'concluded';
  }
}

export function offlineBriefing(game, report) {
  const player = NATIONS_BY_ID[game.playerId];
  const state = game.nations[game.playerId];
  const paragraphs = [];
  const dispatches = [];

  // Orders.
  if (report.playerOutcomes.length) {
    const parts = report.playerOutcomes.map((o) => {
      const target = o.targetId ? ` toward ${NATIONS_BY_ID[o.targetId].name}` : '';
      return `${o.actionName}${target} ${toneWord(o.tier)}`;
    });
    paragraphs.push(
      `Your government's programme for the quarter: ${joinList(parts)}. ${
        report.playerOutcomes.some((o) => o.tier === 'backfire')
          ? 'At least one file is now a political liability rather than an achievement.'
          : 'The permanent secretaries consider the quarter closed.'
      }`,
    );
  } else {
    paragraphs.push(
      `Your government issued no substantive orders this quarter. The machinery of state continued without direction, which the press has noticed.`,
    );
  }

  // Economy and domestic.
  const growth = report.economy?.playerGrowth ?? 0;
  const econ = growth > 0.6
    ? 'The economy is running warm'
    : growth > 0.15
      ? 'The economy is growing, slowly'
      : growth > -0.2
        ? 'The economy is flat'
        : 'The economy is contracting';
  paragraphs.push(
    `${econ}: GDP moved ${growth >= 0 ? '+' : ''}${growth}% on the quarter, against revenue of ${usd(report.economy?.playerRevenue ?? 0)} and military upkeep of ${usd(report.economy?.playerUpkeep ?? 0)}. ` +
      `Stability stands at ${Math.round(state.stability)}, unrest at ${Math.round(state.unrest)}, and approval at ${Math.round(state.approval)}. ` +
      `${state.treasury < 0 ? 'The treasury is in deficit and the bond desk has started returning calls late.' : `Reserves of ${usd(state.treasury)} remain available.`}`,
  );

  // The world.
  const worldBits = [];
  for (const e of report.events.slice(0, 3)) worldBits.push(e.text);
  const notable = report.worldOutcomes.filter((o) => o.major).slice(0, 3);
  for (const o of notable) {
    const actor = NATIONS_BY_ID[o.actorId].name;
    const target = o.targetId ? ` against ${NATIONS_BY_ID[o.targetId].name}` : '';
    worldBits.push(`${actor}: ${o.actionName.toLowerCase()}${target}.`);
  }
  if (worldBits.length) paragraphs.push(worldBits.join(' '));

  // War.
  const warBits = report.wars.map((w) => w.text).filter(Boolean);
  if (warBits.length) paragraphs.push(warBits.join(' '));

  // Dispatches.
  for (const e of report.events.slice(0, 2)) {
    dispatches.push({ source: pick(OUTLETS, e.title.length + report.turn), text: e.text });
  }
  for (const o of notable.slice(0, 2)) {
    dispatches.push({
      source: pick(OUTLETS, o.actionName.length + report.turn + 3),
      text: `${NATIONS_BY_ID[o.actorId].name}: ${o.text || o.actionName}`,
    });
  }
  if (report.decision) {
    dispatches.push({ source: 'Cabinet Office', text: report.decision.text });
  }

  const headline = buildHeadline(game, report);
  const advisorNote = buildAdvice(game, report);

  return {
    headline,
    briefing: paragraphs,
    dispatches: dispatches.slice(0, 5),
    advisorNote,
    outlook: report.newDecision
      ? `${report.newDecision.title} is on your desk and will not wait.`
      : `World tension sits at ${Math.round(game.worldTension)}/100 going into ${dateLabel(game)}.`,
  };
}

function buildHeadline(game, report) {
  const player = NATIONS_BY_ID[game.playerId];
  const nuclear = report.wars.find((w) => w.type === 'nuclear');
  if (nuclear) return 'Nuclear weapons used in anger for the first time since 1945';

  const warEnd = report.wars.find((w) => w.type === 'war-end');
  if (warEnd) return warEnd.text.split('.')[0];

  const backfire = report.playerOutcomes.find((o) => o.tier === 'backfire');
  if (backfire) return `${player.adjective} government reeling after ${backfire.actionName.toLowerCase()} collapses`;

  const crit = report.playerOutcomes.find((o) => o.tier === 'critical');
  if (crit) return `${crit.actionName} lands better than anyone in ${player.name} expected`;

  if (report.events.length) return report.events[0].title;
  if (game.worldTension > 78) return 'World tension climbs toward the top of the scale';
  return `${player.name} closes a quarter without incident`;
}

function buildAdvice(game, report) {
  const state = game.nations[game.playerId];
  const mods = difficultyModifiers(game.difficulty);

  if (state.treasury < 0) return 'We are spending money we do not have. Consolidate, or the markets will do it for us.';
  if (state.unrest > 65) return 'The streets are the problem now, not the neighbours. Fix that first.';
  if (state.stability < 35) return 'The institutions are failing faster than the economy. Reform or crack down, but choose.';
  if (game.wars.some((w) => w.active && (w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId)))) {
    return 'We are at war. Every quarter it continues costs more than the last.';
  }
  if (game.worldTension > 70) return 'The world is one incident away from something none of us control. Keep a channel open.';
  if (state.treasury > state.gdp * 120) return 'We are hoarding capacity we could be deploying. Idle reserves buy nothing.';
  if (mods.level >= 8) return 'Everyone is moving against us at once. Pick the fight you can win and ignore the rest.';
  return 'Quiet quarters are when position gets built. Spend the calm on something compounding.';
}

export function offlineOpening(game) {
  const player = NATIONS_BY_ID[game.playerId];
  const state = game.nations[game.playerId];
  const mods = difficultyModifiers(game.difficulty);
  const rivals = Object.keys(game.nations)
    .filter((id) => id !== game.playerId)
    .map((id) => ({ id, rel: game.relations[[game.playerId, id].sort().join('|')] ?? 0 }))
    .sort((a, b) => a.rel - b.rel)
    .slice(0, 2)
    .map((r) => NATIONS_BY_ID[r.id].name);

  return {
    headline: `You take office as ${player.leaderTitle} of ${player.name}`,
    briefing: [
      `${player.brief} You inherit a $${state.gdp.toFixed(1)}T economy, ${Math.round(state.population)} million people, ` +
        `stability at ${Math.round(state.stability)}, and ${usd(state.treasury)} you can actually spend this quarter.`,
      `The world you have joined is running at ${Math.round(game.worldTension)}/100 tension on a ${mods.tier.name} setting — ${mods.tier.blurb.toLowerCase()} ` +
        `Your most difficult relationships are with ${rivals.join(' and ')}.`,
      `You have ${game.totalTurns} quarters. Your objectives: ${game.objectives.map((o) => o.title.toLowerCase()).join(', ')}. ` +
        `Nobody will remind you of them again.`,
    ],
    dispatches: [
      { source: 'Cabinet Office', text: `Transition complete. The ${player.leaderTitle.toLowerCase()}'s first orders are expected within the quarter.` },
    ],
    advisorNote: 'First quarter sets the tone. Do one thing properly rather than four things badly.',
    outlook: 'Everything from here is your record.',
  };
}

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]}, and ${items[1]}`;
  return `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;
}
