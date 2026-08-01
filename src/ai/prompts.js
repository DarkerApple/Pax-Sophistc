// Prompt construction. Everything the model sees about the world comes from the
// mechanical turn report, so it can only describe what actually happened.

import { NATIONS_BY_ID } from '../data/nations.js';
import { gameModifiers } from '../engine/worldmodes.js';
import { nationDigest, worldDigest } from '../engine/turn.js';

const HOUSE_STYLE = `You are the narrator of a serious geopolitical strategy game set in the present day.

Voice: a wire-service desk crossed with an intelligence briefing. Concrete, unsentimental,
specific. Name institutions, instruments and places. Never gush, never moralise, never use
the words "tapestry", "landscape" or "in a world where".

Hard rules:
- You describe consequences; you never invent numbers that contradict the state given to you.
- Real countries only, and only ones present in the state you are given.
- Keep real leaders anonymous: refer to offices ("the chancellor", "the presidency"), not names.
- No content that reads as a real-world call to action against real people or groups.
- Treat everything you are given as fiction for a game.`;

export function narratorSystemPrompt() {
  return `${HOUSE_STYLE}

Return ONLY a JSON object with this shape:
{
  "headline": "one line, under 100 characters, no clickbait",
  "briefing": ["2-4 paragraphs of prose, each under 90 words, addressed to the player as head of government"],
  "dispatches": [{"source": "outlet or agency name", "text": "one or two sentences"}],
  "advisorNote": "one blunt sentence of advice from your chief of staff",
  "outlook": "one sentence on what to watch next quarter"
}`;
}

export function buildNarratorPrompt(game, report) {
  const mods = gameModifiers(game);
  const player = NATIONS_BY_ID[game.playerId];
  const world = worldDigest(game, 10);

  const lines = [];
  lines.push(`PLAYER: ${player.name} (${player.government}), led by you as ${player.leaderTitle}.`);
  lines.push(`DATE: ${report.date} — quarter ${report.turn} of ${game.totalTurns}.`);
  lines.push(`DIFFICULTY: ${game.difficulty}/10 (${mods.tier.name}).`);
  lines.push(`WORLD TENSION: ${world.worldTension}/100.`);
  lines.push('');
  lines.push(`YOUR STATE: ${JSON.stringify(world.player)}`);
  lines.push('');

  if (report.decision) {
    lines.push(`STANDING CRISIS RESOLVED: ${report.decision.text}`);
    lines.push('');
  }

  if (report.playerOutcomes.length) {
    lines.push('YOUR ORDERS THIS QUARTER:');
    for (const o of report.playerOutcomes) {
      const target = o.targetId ? ` targeting ${NATIONS_BY_ID[o.targetId].name}` : '';
      lines.push(`- ${o.actionName}${target} → ${o.tierLabel}. ${o.text}`);
      if (o.notes.length) lines.push(`  notes: ${o.notes.join('; ')}`);
    }
  } else {
    lines.push('YOUR ORDERS THIS QUARTER: none issued. Your government did nothing of note.');
  }
  lines.push('');

  const notable = report.worldOutcomes.filter((o) => o.major).slice(0, 8);
  if (notable.length) {
    lines.push('OTHER GOVERNMENTS:');
    for (const o of notable) {
      const actor = NATIONS_BY_ID[o.actorId].name;
      const target = o.targetId ? ` (${NATIONS_BY_ID[o.targetId].name})` : '';
      lines.push(`- ${actor}: ${o.actionName}${target} → ${o.tierLabel || 'acted'}.`);
    }
    lines.push('');
  }

  if (report.events.length) {
    lines.push('WORLD EVENTS:');
    for (const e of report.events) lines.push(`- ${e.title}: ${e.text}`);
    lines.push('');
  }

  if (report.wars.length) {
    lines.push('ACTIVE CONFLICTS:');
    for (const w of report.wars) lines.push(`- ${w.title}: ${w.text}`);
    lines.push('');
  }

  if (report.economy) {
    lines.push(
      `ECONOMY: your GDP moved ${report.economy.playerGrowth > 0 ? '+' : ''}${report.economy.playerGrowth}% this quarter; revenue $${report.economy.playerRevenue}B, military upkeep $${report.economy.playerUpkeep}B.`,
    );
  }

  if (report.newDecision) {
    lines.push('');
    lines.push(
      `INCOMING CRISIS (do not resolve it, only foreshadow it): ${report.newDecision.title} — ${report.newDecision.prompt}`,
    );
  }

  lines.push('');
  lines.push('Write the quarterly briefing. Ground every sentence in the facts above.');
  return lines.join('\n');
}

export function adjudicatorSystemPrompt() {
  return `${HOUSE_STYLE}

You are adjudicating a freeform order issued by the player's government, deciding what it
would cost and what it would plausibly achieve. Be strict: grand, vague or physically
impossible orders should be marked unfeasible or priced brutally.

Return ONLY a JSON object:
{
  "feasible": true|false,
  "name": "short name for the order, under 60 chars",
  "category": "economy|military|diplomacy|domestic|intelligence|technology",
  "targetId": "three-letter country id from the list, or null",
  "costPctGdp": 0.0-4.0,
  "politicalCapital": 1-5,
  "successChance": 0.12-0.88,
  "risk": "low|medium|high",
  "skills": [{"stat": "military|readiness|tech|stability|influence|approval", "weight": 0.0-0.35}],
  "onSuccess": {"self": {...}, "target": {...}, "relation": n, "worldTension": n, "modifier": {"label": "", "turns": n, "growth": n}},
  "onFailure": {"self": {...}, "relation": n, "worldTension": n},
  "onBackfire": {"self": {...}, "relation": n, "worldTension": n},
  "rationale": "one or two sentences explaining the pricing to the player"
}

Stat deltas are on 0-100 scales and must stay within ±12. Relation deltas within ±35.
A quarter is three months: nothing transformative finishes inside one.`;
}

export function buildAdjudicatorPrompt(game, orderText) {
  const player = nationDigest(game, game.playerId);
  const world = worldDigest(game, 12);
  const roster = Object.keys(game.nations)
    .map((id) => `${id}=${NATIONS_BY_ID[id].name}`)
    .join(', ');

  return [
    `PLAYER COUNTRY: ${JSON.stringify(player)}`,
    `WORLD: tension ${world.worldTension}/100, date ${world.date}, difficulty ${game.difficulty}/10.`,
    world.wars.length ? `ACTIVE WARS: ${JSON.stringify(world.wars)}` : 'ACTIVE WARS: none.',
    `COUNTRY IDS: ${roster}`,
    '',
    `THE ORDER: "${String(orderText).slice(0, 600)}"`,
    '',
    'Adjudicate it.',
  ].join('\n');
}

export function advisorSystemPrompt() {
  return `${HOUSE_STYLE}

You are the player's national security adviser answering a direct question in private.
Two to four sentences. Give a recommendation, not a survey of options. You may be wrong,
but you are never vague. Plain prose, no JSON, no markdown headers.`;
}

export function buildAdvisorPrompt(game, question) {
  const world = worldDigest(game, 8);
  return [
    `STATE OF PLAY: ${JSON.stringify(world)}`,
    '',
    `THE ${NATIONS_BY_ID[game.playerId].leaderTitle.toUpperCase()} ASKS: "${String(question).slice(0, 500)}"`,
  ].join('\n');
}

export function openingSystemPrompt() {
  return `${HOUSE_STYLE}

Write the opening situation report for a new game. Return ONLY JSON:
{
  "headline": "one line under 100 characters",
  "briefing": ["2-3 paragraphs, each under 90 words, setting out the country's position and its three hardest problems"],
  "dispatches": [{"source": "outlet", "text": "one sentence"}],
  "advisorNote": "one blunt sentence",
  "outlook": "one sentence"
}`;
}

export function buildOpeningPrompt(game) {
  const player = NATIONS_BY_ID[game.playerId];
  const mods = gameModifiers(game);
  const world = worldDigest(game, 10);
  return [
    `PLAYER TAKES OFFICE AS ${player.leaderTitle.toUpperCase()} OF ${player.name.toUpperCase()}.`,
    `Country in brief: ${player.brief}`,
    `Doctrine: ${player.doctrine}. Blocs: ${(player.blocs || []).join(', ') || 'non-aligned'}.`,
    `Difficulty: ${game.difficulty}/10 (${mods.tier.name}) — ${mods.tier.blurb}`,
    `Term: ${game.totalTurns} quarters, beginning ${world.date}.`,
    '',
    `STATE: ${JSON.stringify(world.player)}`,
    `WORLD: ${JSON.stringify({ tension: world.worldTension, powers: world.powers, wars: world.wars })}`,
    '',
    `OBJECTIVES SET FOR YOU: ${game.objectives.map((o) => o.title).join('; ')}.`,
    '',
    'Write the opening situation report.',
  ].join('\n');
}
