// The things that land on the desk and will not wait.
//
// A decision is not an order. An order is something you chose to do with a
// quarter; a decision is something that has already happened and is now yours,
// with a deadline, an incomplete brief, and nobody who agrees with anybody.
//
// The six that existed were all shaped the same way: a rival does something,
// you concede or stall or refuse. These are deliberately different shapes —
// choices that cost money rather than standing, choices where every option is
// bad, choices with no reversible answer, choices that are only hard because of
// who at home is watching. Each one names the faction that will be pleased and
// the one that will not, because that is now the second axis of everything.

import { NATIONS_BY_ID } from '../data/nations.js';
import {
  activeWarsFor,
  blocsOf,
  defOf,
  getRelation,
  livePower,
  sovereignIds,
  sovereignStates,
} from './state.js';
import { areaOf, neighboursOf } from './territory.js';
import { alliesOf, treatiesFor } from './treaties.js';
import { nemesisOf } from './nemesis.js';

/** Defaults, so each decision below is only its own shape. */
function d(id, title, opts) {
  return { id, kind: 'decision', title, weight: () => 1, ...opts };
}

/** Whoever the player is most at odds with, for the decisions that need one. */
function rivalFor(game, rng, floor = -35) {
  const hostile = sovereignStates(game).filter(
    (n) => n.id !== game.playerId && getRelation(game, game.playerId, n.id) < floor,
  );
  if (!hostile.length) return null;
  return rng.weighted(hostile, (n) => livePower(game, n.id));
}

function friendFor(game, rng, floor = 35) {
  const warm = sovereignStates(game).filter(
    (n) => n.id !== game.playerId && getRelation(game, game.playerId, n.id) > floor,
  );
  if (!warm.length) return null;
  return rng.weighted(warm, (n) => getRelation(game, game.playerId, n.id));
}

function neighbourFor(game, rng) {
  const near = neighboursOf(game, game.playerId).filter((id) => game.nations[id]?.sovereign !== false);
  return near.length ? rng.pick(near) : null;
}

/** @type {Array<object>} */
export const DECISIONS = [
  // ── Money on the table ────────────────────────────────────────────────────
  d('decision-bailout', 'The Bank Will Not Open Monday', {
    weight: (game) => (game.nations[game.playerId].stability < 70 ? 1.2 : 0.6),
    build: (game) => {
      const state = game.nations[game.playerId];
      const cost = Number((state.gdp * 2.4).toFixed(1));
      return {
        prompt: `The third-largest bank in the country cannot meet its obligations on Monday morning. The governor of the central bank is in your outer office and has been there since four. A rescue costs roughly $${Math.round(cost)}B of public money; a failure costs something nobody can put a number on.`,
        choices: [
          {
            id: 'rescue', label: 'Underwrite it in full',
            detail: 'Public money, tonight, and the argument about moral hazard can wait until nobody is queueing.',
            cost: { pctGdp: 2.4 },
            effect: { self: { stability: 6, approval: -7, unrest: 4 }, modifier: { label: 'Bank rescue', turns: 8, growth: 0.1 } },
            factions: { capital: 5, street: -4 },
          },
          {
            id: 'resolve', label: 'Wind it up over the weekend',
            detail: 'Depositors protected, shareholders wiped out, management prosecuted. It is the correct answer and it is not the safe one.',
            chance: 0.62, cost: { pctGdp: 0.9 },
            effect: { self: { approval: 8, stability: 2, unrest: -2 } },
            failEffect: { self: { stability: -9, approval: -6, unrest: 8 }, modifier: { label: 'Banking panic', turns: 6, growth: -0.45 } },
            factions: { street: 5, capital: -4 },
          },
          {
            id: 'let-fall', label: 'Let it fail',
            detail: 'Somebody has to be allowed to fail or none of them ever will. Find out on Monday which of the others were relying on it.',
            chance: 0.42,
            effect: { self: { approval: 4, stability: -3 }, modifier: { label: 'Market discipline', turns: 8, growth: 0.15 } },
            failEffect: { self: { stability: -14, approval: -10, unrest: 12 }, modifier: { label: 'Financial contagion', turns: 8, growth: -0.7 } },
            factions: { capital: -6, street: 2 },
          },
        ],
      };
    },
  }),

  d('decision-windfall', 'An Unexpected Windfall', {
    weight: (game) => ((game.nations[game.playerId].tags || []).some((t) => /oil|gas|mining|rare/.test(t)) ? 1.3 : 0.5),
    build: (game) => ({
      prompt: 'A commodity price spike has left the treasury with rather more money than the budget assumed. Four ministers have already written to you about it, and the letters do not agree.',
      choices: [
        {
          id: 'save', label: 'Put it in the fund',
          detail: 'Nobody will thank you. In eight years somebody will.',
          effect: { self: { treasuryPctGdp: 3, approval: -3 }, modifier: { label: 'Sovereign savings', turns: 12, growth: 0.12 } },
          factions: { capital: 5, street: -3 },
        },
        {
          id: 'spend', label: 'Spend it on people',
          detail: 'Wages, pensions, the hospital list. It goes immediately and it is felt immediately.',
          effect: { self: { approval: 11, unrest: -8 }, modifier: { label: 'Windfall spending', turns: 4, growth: 0.2 } },
          factions: { street: 6, capital: -3 },
        },
        {
          id: 'rearm', label: 'Buy the equipment programme',
          detail: 'The one that has been deferred three times. The staff will remember this.',
          effect: { self: { military: 4, readiness: 6, approval: -2 } },
          factions: { staff: 6, street: -3 },
        },
        {
          id: 'cut-tax', label: 'Give it back',
          detail: 'A rebate, in everybody’s account, before the next election. It is not an economic decision.',
          effect: { self: { approval: 9, treasuryPctGdp: -0.5 }, modifier: { label: 'Tax rebate', turns: 6, growth: 0.14 } },
          factions: { capital: 3, party: 4 },
        },
      ],
    }),
  }),

  // ── Every option is bad ───────────────────────────────────────────────────
  d('decision-hostages', 'They Have Forty of Your Citizens', {
    weight: (game) => (game.worldTension > 45 ? 1.1 : 0.5),
    build: (game, rng) => {
      const rival = rivalFor(game, rng, -20);
      if (!rival) return null;
      return {
        targetId: rival.id,
        prompt: `Forty of your citizens are being held in ${NATIONS_BY_ID[rival.id].name}. The families have been on television since Tuesday. There is a price, there is a rescue plan the staff rate at even odds, and there is the option nobody will say out loud.`,
        choices: [
          {
            id: 'pay', label: 'Pay, quietly',
            detail: 'It works. It also tells everybody watching exactly what your citizens are worth.',
            cost: { pctGdp: 0.6 },
            effect: { self: { approval: 6, influence: -5 }, relation: 8 },
            factions: { street: 4, staff: -5 },
          },
          {
            id: 'rescue', label: 'Send the rescue',
            detail: 'Even odds. If it works you will be remembered for it, and if it does not you will be remembered for it.',
            chance: 0.5,
            effect: { self: { approval: 16, readiness: 3, influence: 4 }, relation: -25, worldTension: 8 },
            failEffect: { self: { approval: -18, unrest: 9, readiness: -5 }, relation: -35, worldTension: 14 },
            factions: { staff: 6, street: -2 },
          },
          {
            id: 'sanction', label: 'Refuse and squeeze',
            detail: 'No payment, no operation. Sanctions until they hand them back. It takes months and everybody knows it.',
            effect: { self: { approval: -6, influence: 3 }, relation: -18, target: { stability: -3 }, worldTension: 5 },
            factions: { party: 3, street: -5 },
          },
        ],
      };
    },
  }),

  d('decision-plague-ship', 'The Ship Cannot Dock', {
    weight: (game) => ((game.nations[game.playerId].tags || []).some((t) => /port|island|shipping|strait/.test(t)) ? 1.2 : 0.7),
    build: () => ({
      prompt: 'A container vessel with eleven hundred crew and passengers is standing off your largest port with an outbreak aboard. Three other countries have already refused it. The captain is asking, on an open channel, what you intend to do.',
      choices: [
        {
          id: 'admit', label: 'Bring them in',
          detail: 'Quarantine wing, full screening, and a domestic argument that will run for a year.',
          cost: { pctGdp: 0.4 },
          effect: { self: { influence: 8, approval: -5, unrest: 5 }, worldTension: -2 },
          factions: { street: -4, party: 3 },
        },
        {
          id: 'refuse', label: 'Turn it away',
          detail: 'Popular at home this week. Every government watching files it.',
          effect: { self: { approval: 7, influence: -9, unrest: -3 } },
          factions: { street: 5, party: -3 },
        },
        {
          id: 'offshore', label: 'Treat them offshore',
          detail: 'Medical teams, supplies and a field hospital on the quarantine anchorage. Expensive, slow, and it satisfies nobody entirely.',
          chance: 0.7, cost: { pctGdp: 0.8 },
          effect: { self: { influence: 5, approval: 2, tech: 1 } },
          failEffect: { self: { influence: -3, approval: -6, unrest: 6 } },
          factions: { capital: -2, street: 1 },
        },
      ],
    }),
  }),

  // ── Somebody at home ──────────────────────────────────────────────────────
  d('decision-general', 'The General Will Not Stand Down', {
    weight: (game) => (game.nations[game.playerId].stability < 62 ? 1.4 : 0.4),
    build: () => ({
      prompt: 'Your most capable field commander has given an interview criticising the government by name. He is popular, he is right about two of the three things, and half the officer corps trained under him.',
      choices: [
        {
          id: 'sack', label: 'Sack him',
          detail: 'Civilian control means nothing if it is not exercised. It also means nothing if the army does not accept it.',
          chance: 0.66,
          effect: { self: { stability: 5, approval: 3, readiness: -5 } },
          failEffect: { self: { stability: -12, unrest: 8, readiness: -9 } },
          factions: { staff: -6, party: 4 },
        },
        {
          id: 'promote', label: 'Promote him upstairs',
          detail: 'A larger title, a smaller command, and an office some distance from any troops.',
          chance: 0.78,
          effect: { self: { stability: 3, readiness: -2, approval: -2 } },
          failEffect: { self: { stability: -4, readiness: -3 } },
          factions: { staff: 2, party: 2 },
        },
        {
          id: 'concede', label: 'Give him what he asked for',
          detail: 'He was right about two of the three. Say so publicly and buy the army.',
          cost: { pctGdp: 1.1 },
          effect: { self: { readiness: 8, military: 2, approval: -6, stability: -3 } },
          factions: { staff: 7, street: -4, party: -3 },
        },
      ],
    }),
  }),

  d('decision-verdict', 'The Court Has Ruled Against You', {
    weight: (game) => (game.nations[game.playerId].approval < 55 ? 1.2 : 0.6),
    build: () => ({
      prompt: 'The constitutional court has struck down your flagship programme. The judgment is nine pages long and the operative sentence is one line. Your law officers say the reasoning is weak. Everybody else says that is not the point.',
      choices: [
        {
          id: 'comply', label: 'Comply, and redraft',
          detail: 'Lose the year. Keep the thing that makes the country work.',
          effect: { self: { stability: 7, approval: -6 }, modifier: { label: 'Programme redrafted', turns: 5, growth: -0.12 } },
          factions: { party: -3, capital: 4 },
        },
        {
          id: 'legislate', label: 'Legislate around it',
          detail: 'A new bill that does the same thing in a way the judgment does not cover. Legal, arguably.',
          chance: 0.6,
          effect: { self: { approval: 4, stability: -4 } },
          failEffect: { self: { stability: -10, approval: -7, unrest: 7 } },
          factions: { party: 5, capital: -3 },
        },
        {
          id: 'ignore', label: 'Decline to implement it',
          detail: 'Nothing in the constitution says what happens if a government simply does not. You are about to find out what does.',
          confirm: true,
          effect: { self: { approval: 3, stability: -14, unrest: 10, influence: -6 } },
          factions: { party: 3, capital: -6, street: -3 },
        },
      ],
    }),
  }),

  d('decision-leak', 'Everything Is In Tomorrow’s Paper', {
    weight: () => 1,
    build: (game, rng) => {
      const rival = rivalFor(game, rng, -10);
      return {
        targetId: rival?.id || null,
        prompt: `An editor has called to say that tomorrow’s edition carries eleven thousand internal documents${rival ? `, including everything your service has been doing inside ${NATIONS_BY_ID[rival.id].name}` : ''}. They are offering you until six o’clock to comment.`,
        choices: [
          {
            id: 'own-it', label: 'Get ahead of it',
            detail: 'Publish it yourself, at four, with the context. It is the only version anybody reads twice.',
            chance: 0.68,
            effect: { self: { approval: 5, stability: 2, influence: -3 } },
            failEffect: { self: { approval: -8, stability: -5, influence: -6 } },
            factions: { street: 4, party: -2 },
          },
          {
            id: 'injunct', label: 'Injunct the paper',
            detail: 'It will hold for about nine hours and then it will be everywhere, with an injunction attached to the story.',
            chance: 0.35,
            effect: { self: { stability: 3, influence: -2 } },
            failEffect: { self: { approval: -11, stability: -6, influence: -8, unrest: 6 } },
            factions: { party: 4, street: -6 },
          },
          {
            id: 'silence', label: 'Say nothing',
            detail: 'No comment, no denial, no correction. Let it be somebody else’s story by Thursday.',
            effect: { self: { approval: -5, influence: -4, stability: -1 } },
            factions: { party: 1 },
          },
        ],
      };
    },
  }),

  // ── The alliance ──────────────────────────────────────────────────────────
  d('decision-ally-calls', 'Your Ally Is Calling', {
    weight: (game) => (alliesOf(game, game.playerId).length ? 1.5 : 0),
    build: (game, rng) => {
      const allies = alliesOf(game, game.playerId).filter((a) => game.nations[a.id]?.sovereign !== false);
      if (!allies.length) return null;
      const ally = rng.pick(allies);
      const name = defOf(game, ally.id)?.name || ally.id;
      return {
        targetId: ally.id,
        prompt: `${name} has invoked its arrangement with you. Their foreign minister is on the line, their ambassador is downstairs, and the text of what you signed is on the desk in front of you. Nobody in the room can find a reading of it that does not oblige you.`,
        choices: [
          {
            id: 'honour', label: 'Honour it in full',
            detail: 'Formations, not statements. It is what the paper says and everybody will know whether you did it.',
            cost: { pctGdp: 1.2 },
            effect: { self: { influence: 9, readiness: -6, approval: -5, unrest: 4 }, relation: 30, worldTension: 8 },
            factions: { staff: 4, party: 2, street: -6 },
          },
          {
            id: 'material', label: 'Send everything but soldiers',
            detail: 'Money, munitions, intelligence, and a very carefully worded statement about the nature of the commitment.',
            cost: { pctGdp: 0.7 },
            effect: { self: { influence: 1, readiness: -2 }, relation: 10, worldTension: 3 },
            factions: { capital: -2, street: 2 },
          },
          {
            id: 'refuse', label: 'Decline',
            detail: 'The paper says one thing and the country says another. Everybody with your signature on something will read the answer.',
            confirm: true,
            effect: { self: { influence: -14, approval: 4 }, relation: -40, worldTension: 4 },
            factions: { street: 5, staff: -6, party: -3 },
          },
        ],
      };
    },
  }),

  d('decision-basing-request', 'They Want a Base', {
    weight: (game) => (treatiesFor(game, game.playerId).length ? 1 : 0.5),
    build: (game, rng) => {
      const friend = friendFor(game, rng, 30);
      if (!friend) return null;
      return {
        targetId: friend.id,
        prompt: `${NATIONS_BY_ID[friend.id].name} would like a permanent facility on your territory. They are offering money, equipment and a security guarantee that is worth rather more than either. Two of your provinces have already said no.`,
        choices: [
          {
            id: 'grant', label: 'Grant it',
            detail: 'A runway, a jetty and four thousand foreign soldiers, indefinitely.',
            effect: {
              self: { readiness: 7, influence: 4, unrest: 8, approval: -7, treasuryPctGdp: 1.5 },
              relation: 26, worldTension: 6,
            },
            factions: { staff: 5, capital: 3, street: -6 },
          },
          {
            id: 'limited', label: 'Access, not a base',
            detail: 'Port visits and overflight, reviewed annually. Half the benefit and a fifth of the argument.',
            effect: { self: { readiness: 3, influence: 2, unrest: 2 }, relation: 12 },
            factions: { party: 3, street: -1 },
          },
          {
            id: 'decline', label: 'Decline',
            detail: 'Politely, and in a way that leaves the question open for a successor.',
            effect: { self: { approval: 5, influence: -3 }, relation: -10 },
            factions: { street: 4, staff: -3 },
          },
        ],
      };
    },
  }),

  // ── The one you cannot take back ──────────────────────────────────────────
  d('decision-refugee-column', 'Two Hundred Thousand at the Border', {
    weight: (game) => {
      const nearWar = neighboursOf(game, game.playerId).some((id) =>
        game.wars.some((w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id))));
      return nearWar ? 2.2 : 0.3;
    },
    build: (game, rng) => {
      const neighbour = neighbourFor(game, rng);
      return {
        targetId: neighbour,
        prompt: `A column of roughly two hundred thousand people is on the road toward your frontier${neighbour ? ` from ${defOf(game, neighbour)?.name}` : ''}. The crossing is a two-lane road and a customs shed. Whatever you decide, you decide it before Thursday.`,
        choices: [
          {
            id: 'open', label: 'Open the border',
            detail: 'Camps, clinics, schools, and a decade of consequences you are choosing on a Tuesday.',
            cost: { pctGdp: 1.4 },
            effect: {
              self: { influence: 10, unrest: 9, approval: -8, population: 1.6 },
              modifier: { label: 'Displaced population', turns: 12, growth: 0.08, unrest: 0.4 },
              worldTension: -3,
            },
            factions: { street: -6, party: -3, capital: 2 },
          },
          {
            id: 'screen', label: 'Screen and admit some',
            detail: 'Families and the wounded through, everybody else registered and held. It is the answer that satisfies nobody and works.',
            chance: 0.72, cost: { pctGdp: 0.7 },
            effect: { self: { influence: 4, unrest: 4, approval: -3, population: 0.6 } },
            failEffect: { self: { unrest: 11, approval: -8, influence: -4 } },
            factions: { party: 3, street: -2 },
          },
          {
            id: 'seal', label: 'Seal the frontier',
            detail: 'Soldiers, wire and orders that somebody will have to carry out on camera.',
            confirm: true,
            effect: { self: { approval: 8, unrest: -4, influence: -13 }, worldTension: 4 },
            factions: { street: 5, staff: 2, party: -2 },
          },
        ],
      };
    },
  }),

  d('decision-strike-window', 'The Window Is Open For Six Hours', {
    weight: (game) => {
      const rival = nemesisOf(game);
      return rival ? 1.6 : 0.4;
    },
    build: (game, rng) => {
      const rival = nemesisOf(game) || rivalFor(game, rng, -45);
      const id = rival?.id || rival;
      if (!id || !game.nations[id]) return null;
      return {
        targetId: id,
        prompt: `Your service has located the facility. It will be empty of civilians for about six hours, starting at two in the morning, and it will not be empty again. ${NATIONS_BY_ID[id].name} will know within the hour who did it, whatever anybody says afterwards.`,
        choices: [
          {
            id: 'strike', label: 'Take the window',
            detail: 'Six hours, and then the question is theirs to answer rather than yours.',
            chance: 0.64, confirm: true,
            effect: { target: { military: -6, tech: -4, stability: -4 }, self: { approval: 5, influence: -6 }, relation: -40, worldTension: 16 },
            failEffect: { self: { approval: -12, influence: -12, readiness: -4 }, relation: -50, worldTension: 22 },
            factions: { staff: 6, street: -4, party: -3 },
          },
          {
            id: 'expose', label: 'Publish what you found',
            detail: 'No strike. Photographs, coordinates and an inspection demand, in front of everybody.',
            chance: 0.7,
            effect: { self: { influence: 8, approval: 3 }, target: { influence: -8, stability: -2 }, relation: -18, worldTension: 7 },
            failEffect: { self: { influence: -6 }, relation: -12, worldTension: 4 },
            factions: { party: 4, staff: -3 },
          },
          {
            id: 'watch', label: 'Do nothing, and keep watching',
            detail: 'The window closes. The file stays open. You will be asked about this at some point in the future by somebody who knows how it ended.',
            effect: { self: { influence: 1 } },
            factions: { staff: -4, street: 2 },
          },
        ],
      };
    },
  }),

  // ── The domestic bargain ──────────────────────────────────────────────────
  d('decision-strike-settlement', 'The Country Has Stopped', {
    weight: (game) => (game.nations[game.playerId].unrest > 48 ? 1.9 : 0.4),
    build: () => ({
      prompt: 'Nothing has moved for nine days. The union leadership will settle tonight for a number your finance ministry says is impossible, or they will escalate to the power stations on Monday.',
      choices: [
        {
          id: 'settle', label: 'Settle at their number',
          detail: 'It ends tonight and it sets every wage negotiation for three years.',
          cost: { pctGdp: 1.8 },
          effect: { self: { unrest: -16, approval: 7 }, modifier: { label: 'Wage settlement', turns: 10, growth: -0.2 } },
          factions: { street: 7, capital: -6 },
        },
        {
          id: 'split', label: 'Split the difference and buy the moderates',
          detail: 'A smaller number, offered to three of the five unions, with a deadline.',
          chance: 0.6,
          cost: { pctGdp: 0.9 },
          effect: { self: { unrest: -10, approval: 3 } },
          failEffect: { self: { unrest: 8, approval: -6, stability: -3 }, modifier: { label: 'Rolling stoppages', turns: 5, growth: -0.3 } },
          factions: { party: 4, street: -1 },
        },
        {
          id: 'break', label: 'Break it',
          detail: 'Emergency powers, essential-services orders, and the police at the depot gates by six.',
          confirm: true, chance: 0.55,
          effect: { self: { unrest: -8, stability: 4, approval: -8, influence: -3 } },
          failEffect: { self: { unrest: 20, stability: -10, approval: -14 }, modifier: { label: 'General strike', turns: 6, growth: -0.55 } },
          factions: { capital: 5, street: -8, staff: 2 },
        },
      ],
    }),
  }),

  d('decision-succession-crisis', 'Your Deputy Has the Votes', {
    weight: (game) => (game.nations[game.playerId].approval < 45 ? 1.5 : 0.3),
    build: () => ({
      prompt: 'Your deputy has spent the recess counting, and the count is finished. They have not moved yet. They have asked for a meeting on Friday, alone, with no officials.',
      choices: [
        {
          id: 'buy', label: 'Give them what they want',
          detail: 'The department, the budget and the succession, in writing. It holds the government together and ends your freedom of action.',
          effect: { self: { stability: 8, approval: 2 }, modifier: { label: 'A divided cabinet', turns: 10, growth: -0.05 } },
          factions: { party: 6, staff: -2 },
        },
        {
          id: 'fight', label: 'Force the vote now',
          detail: 'On your timing rather than theirs, before the count firms up.',
          chance: 0.52,
          effect: { self: { stability: 6, approval: 6, unrest: -2 } },
          failEffect: { self: { stability: -14, approval: -12, unrest: 8 } },
          factions: { party: -4, street: 2 },
        },
        {
          id: 'sack', label: 'Sack them on Thursday',
          detail: 'Before the meeting. It is either decisive or it is the thing that finishes you, and you will not know which until Monday.',
          chance: 0.46, confirm: true,
          effect: { self: { stability: 9, approval: 4 } },
          failEffect: { self: { stability: -18, approval: -14, unrest: 12 } },
          factions: { party: -6, staff: 3 },
        },
      ],
    }),
  }),

  // ── The technical one ─────────────────────────────────────────────────────
  d('decision-breakthrough', 'The Laboratory Has Something', {
    weight: (game) => (game.nations[game.playerId].tech > 58 ? 1.2 : 0.4),
    build: () => ({
      prompt: 'A state laboratory has produced something genuinely new. The director wants to publish. The defence ministry wants it classified. The finance ministry has already found three companies who want to license it.',
      choices: [
        {
          id: 'publish', label: 'Publish it openly',
          detail: 'Every laboratory on earth has it by Friday, and every one of them cites you.',
          effect: { self: { influence: 9, tech: 2 }, modifier: { label: 'Open science', turns: 12, tech: 0.25 }, worldTension: -2 },
          factions: { capital: -2, party: 3 },
        },
        {
          id: 'classify', label: 'Classify it',
          detail: 'Nobody outside the building knows it exists. The advantage lasts exactly as long as that does.',
          effect: { self: { tech: 5, military: 3, influence: -3 }, modifier: { label: 'Classified programme', turns: 10, tech: 0.3 } },
          factions: { staff: 6, capital: 1, street: -2 },
        },
        {
          id: 'license', label: 'License it commercially',
          detail: 'Three firms, exclusive terms, and a royalty stream that pays for the laboratory twice over.',
          effect: { self: { treasuryPctGdp: 1.4, tech: 2 }, modifier: { label: 'Licensing revenue', turns: 12, growth: 0.2 } },
          factions: { capital: 6, street: -1 },
        },
      ],
    }),
  }),

  d('decision-grid-choice', 'The Grid Will Not Take Both', {
    weight: (game) => (game.nations[game.playerId].tech > 45 ? 1 : 0.6),
    build: () => ({
      prompt: 'There is enough capacity coming online for the data centres or for the industrial belt, and not for both. Two ministers, two lobbies, one cable.',
      choices: [
        {
          id: 'compute', label: 'Give it to compute',
          detail: 'The future, allegedly, and a few thousand jobs in one province.',
          effect: { self: { tech: 5, unrest: 3, approval: -3 }, modifier: { label: 'Compute build-out', turns: 10, growth: 0.22, tech: 0.2 } },
          factions: { capital: 5, street: -4 },
        },
        {
          id: 'industry', label: 'Give it to industry',
          detail: 'The present, definitely, and forty thousand jobs in four.',
          effect: { self: { approval: 6, unrest: -4 }, modifier: { label: 'Industrial power', turns: 10, growth: 0.24 } },
          factions: { street: 6, capital: 1 },
        },
        {
          id: 'build', label: 'Build more capacity instead',
          detail: 'Refuse the choice. Pay for it. It arrives in four years, which is somebody else’s term.',
          cost: { pctGdp: 2.2 },
          effect: { self: { tech: 2 }, modifier: { label: 'Grid expansion', turns: 14, growth: 0.3 } },
          factions: { capital: 3, party: -2 },
        },
      ],
    }),
  }),

  // ── Wartime ───────────────────────────────────────────────────────────────
  d('decision-city-or-army', 'The City or the Army', {
    weight: (game) => (activeWarsFor(game, game.playerId).length ? 2.4 : 0),
    build: (game) => {
      const war = activeWarsFor(game, game.playerId)[0];
      if (!war) return null;
      return {
        prompt: `The staff have laid out two plans and there is enough for one. Hold the city — which is a symbol, a rail junction and four hundred thousand people — or withdraw the formations to a line they can actually hold, and explain that on television.`,
        choices: [
          {
            id: 'hold', label: 'Hold the city',
            detail: 'Nobody who has ever done this has said afterwards that it was the correct decision. Everybody who has ever done it did it anyway.',
            chance: 0.45,
            effect: { self: { approval: 12, readiness: -8, unrest: -4 }, worldTension: 3 },
            failEffect: { self: { approval: -10, readiness: -16, unrest: 10, military: -4 } },
            warEffect: { warScore: 10, ownExhaustion: 10, casualties: 24_000 },
            warEffectOnFailure: { warScore: -18, ownExhaustion: 18, casualties: 52_000 },
            factions: { street: 5, staff: -4 },
          },
          {
            id: 'withdraw', label: 'Withdraw to the line',
            detail: 'The army survives. The pictures do not go away for a decade.',
            effect: { self: { approval: -13, readiness: 6, unrest: 8 } },
            warEffect: { warScore: -8, ownExhaustion: -10 },
            factions: { staff: 6, street: -6 },
          },
          {
            id: 'split-force', label: 'Reinforce and hold a corridor',
            detail: 'Neither. A corridor in and out, held with everything, so it is a siege rather than a pocket.',
            chance: 0.55,
            effect: { self: { approval: 4, readiness: -5 } },
            failEffect: { self: { approval: -8, readiness: -12, military: -3 } },
            warEffect: { warScore: 4, ownExhaustion: 6, casualties: 16_000 },
            warEffectOnFailure: { warScore: -14, ownExhaustion: 14, casualties: 38_000 },
            factions: { staff: 2, street: 1 },
          },
        ],
      };
    },
  }),

  d('decision-terms-offered', 'They Have Offered Terms', {
    weight: (game) => (activeWarsFor(game, game.playerId).length ? 1.8 : 0),
    build: (game) => {
      const war = activeWarsFor(game, game.playerId)[0];
      if (!war) return null;
      const winning = war.attackers.includes(game.playerId) ? war.warScore > 0 : war.warScore < 0;
      return {
        prompt: `A third party has passed on terms. ${winning ? 'They are worse than what you could probably take by force, and they are available today.' : 'They are worse than what you told the country you were fighting for, and they are the best that will be offered.'}`,
        choices: [
          {
            id: 'accept', label: 'Accept them',
            detail: 'It ends. Everything you said in the first quarter is now on the record next to this.',
            seeksPeace: true,
            effect: { self: { approval: winning ? -10 : -4, influence: 2, unrest: 4 }, worldTension: -10 },
            factions: { street: 5, staff: -6, party: -3 },
          },
          {
            id: 'counter', label: 'Counter-offer',
            detail: 'One more round of talks, one more quarter of fighting while they happen.',
            chance: 0.5,
            effect: { self: { influence: 4, approval: 2 }, worldTension: -3 },
            failEffect: { self: { approval: -5, influence: -3 }, worldTension: 4 },
            factions: { party: 3 },
          },
          {
            id: 'reject', label: 'Reject them publicly',
            detail: 'Read the terms out on television and say what you think of them.',
            effect: { self: { approval: 8, readiness: 3, unrest: 3 }, worldTension: 7 },
            warEffect: { warScore: 5, ownExhaustion: 5 },
            factions: { staff: 6, street: -3 },
          },
        ],
      };
    },
  }),

  // ── Reputation ────────────────────────────────────────────────────────────
  d('decision-tribunal', 'Your Officer Is Named', {
    weight: (game) => {
      const fought = game.wars.some((w) => w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId));
      return fought ? 1.3 : 0.15;
    },
    build: () => ({
      prompt: 'An international tribunal has named one of your officers. The evidence is partial, the jurisdiction is arguable, and the officer is on television every second night explaining that he was following the orders you signed.',
      choices: [
        {
          id: 'surrender', label: 'Hand him over',
          detail: 'Costly, correct, and the officer corps will not forget which of you it was.',
          effect: { self: { influence: 12, approval: -9, stability: -3, readiness: -3 } },
          factions: { staff: -7, party: 2, street: -1 },
        },
        {
          id: 'try-at-home', label: 'Try him yourself',
          detail: 'A domestic court, a real trial, and a jurisdiction argument you will probably win.',
          chance: 0.66,
          effect: { self: { influence: 6, approval: 1, stability: 2 } },
          failEffect: { self: { influence: -8, approval: -5 } },
          factions: { party: 4, staff: -2 },
        },
        {
          id: 'shield', label: 'Refuse the jurisdiction',
          detail: 'No extradition, no cooperation, no comment. Popular with exactly one constituency.',
          effect: { self: { influence: -12, approval: 5, unrest: 2 }, worldTension: 3 },
          factions: { staff: 6, party: -2 },
        },
      ],
    }),
  }),

  d('decision-summit-invite', 'You Have Been Invited, and So Have They', {
    weight: (game) => (game.worldTension > 40 ? 1.1 : 0.6),
    build: (game, rng) => {
      const rival = nemesisOf(game) || rivalFor(game, rng, -30);
      const id = rival?.id || rival;
      if (!id || !game.nations[id]) return null;
      return {
        targetId: id,
        prompt: `A neutral government has offered to host, and ${NATIONS_BY_ID[id].name} has already accepted. Going means a photograph of the two of you that will be used against you for a decade. Not going means being the one who would not.`,
        choices: [
          {
            id: 'attend', label: 'Go, and negotiate seriously',
            detail: 'Three days, no preconditions, and a communiqué that says less than either delegation wanted.',
            chance: 0.66,
            effect: { self: { influence: 8, approval: -4 }, relation: 24, worldTension: -9 },
            failEffect: { self: { influence: -4, approval: -7 }, relation: -6, worldTension: 3 },
            factions: { party: 3, street: 2, staff: -4 },
          },
          {
            id: 'attend-hard', label: 'Go, and give them nothing',
            detail: 'Attend, smile for the photograph, concede not one line of text.',
            effect: { self: { influence: 3, approval: 4 }, relation: 6, worldTension: -3 },
            factions: { staff: 2, party: 2 },
          },
          {
            id: 'decline', label: 'Decline',
            detail: 'Say why, at length, in a way that makes the refusal itself the position.',
            effect: { self: { influence: -6, approval: 6 }, relation: -14, worldTension: 5 },
            factions: { street: 3, staff: 4, party: -3 },
          },
        ],
      };
    },
  }),
];
