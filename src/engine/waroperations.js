// The War Room, at the operational level.
//
// The existing war orders decide *how hard* to fight: offensive, hold the line,
// press the advantage. These decide *how* — where the weight goes, what is
// risked to get it, and what is done with the ground and the people once it is
// taken. They exist because a war that offers three verbs for eight quarters is
// a war you stop reading.
//
// Every one of them moves the front, the exhaustion or the casualty count
// directly through `warEffect`, so the choice shows up on the map rather than
// only in the national statistics. Most carry a `warEffectOnFailure` too: an
// operation that goes wrong should cost you the ground you were trying to take.

import { activeWarsFor } from './state.js';

/** Defaults, so each operation below is only what makes it different. */
function w(id, name, blurb, opts = {}) {
  return {
    id,
    name,
    blurb,
    category: 'war',
    target: 'none',
    pc: 3,
    risk: 'high',
    baseSuccess: 0.6,
    cost: { pctGdp: 0.9 },
    skills: [['military', 0.18], ['readiness', 0.12]],
    requiresWar: false,
    ...opts,
  };
}

/** @type {Array<object>} */
export const WAR_OPERATIONS = [
  // ── Where the weight goes ─────────────────────────────────────────────────
  w('amphibious-landing', 'Mount an Amphibious Landing', 'Put a corps on a beach behind their line. The most decisive thing you can do and the easiest to lose an army doing.',
    { situational: ['war', 'maritime', 'warStalled', 'warWinning'], cost: { pctGdp: 1.6 }, pc: 4,
      baseSuccess: 0.48, skills: [['military', 0.2], ['readiness', 0.2], ['tech', 0.1]],
      warEffect: { warScore: 20, enemyExhaustion: 12, ownExhaustion: 9, casualties: 22_000 },
      warEffectOnFailure: { warScore: -16, ownExhaustion: 18, casualties: 41_000 },
      effects: {
        success: { self: { approval: 7, readiness: -7 } },
        failure: { self: { approval: -11, readiness: -12, unrest: 7 } },
      } }),

  w('airborne-insertion', 'Drop Behind the Line', 'Light troops, no supply, and a bridge that has to be held for forty-eight hours.',
    { situational: ['war', 'warWinning', 'warStalled', 'techLead'], cost: { pctGdp: 0.8 }, pc: 3,
      baseSuccess: 0.5, skills: [['readiness', 0.24], ['tech', 0.12]],
      warEffect: { warScore: 14, enemyExhaustion: 9, ownExhaustion: 5, casualties: 9_000 },
      warEffectOnFailure: { warScore: -9, ownExhaustion: 9, casualties: 17_000 },
      effects: {
        success: { self: { approval: 5, readiness: -3 } },
        failure: { self: { approval: -8, readiness: -6 } },
      } }),

  w('deep-raid', 'Raid Their Rear Areas', 'Fuel dumps, headquarters, repair depots. It does not take ground; it makes taking ground possible.',
    { situational: ['war', 'warStalled', 'warLosing'], cost: { pctGdp: 0.6 }, pc: 2,
      baseSuccess: 0.66, risk: 'medium', skills: [['readiness', 0.2], ['tech', 0.12]],
      warEffect: { warScore: 8, enemyExhaustion: 11, casualties: 6_000 },
      warEffectOnFailure: { ownExhaustion: 6, casualties: 8_000 },
      effects: {
        success: { self: { readiness: 2 } },
        failure: { self: { readiness: -3, approval: -2 } },
      } }),

  w('counter-battery', 'Win the Artillery Duel', 'Radar, drones and counter-fire. Unglamorous, and it is what actually kills people at the front.',
    { situational: ['war', 'warStalled', 'casualties'], cost: { pctGdp: 0.7 }, pc: 2,
      baseSuccess: 0.72, risk: 'medium', skills: [['tech', 0.2], ['military', 0.1]],
      warEffect: { warScore: 9, enemyExhaustion: 8, casualties: 11_000 },
      warEffectOnFailure: { ownExhaustion: 5, casualties: 9_000 },
      effects: {
        success: { self: { readiness: 3 }, modifier: { label: 'Fire superiority', turns: 5, readiness: 0.3 } },
        failure: { self: { readiness: -3 } },
      } }),

  w('siege-the-city', 'Invest the City', 'Surround it, cut it off, and wait. It works, it takes a year, and the pictures will define your term.',
    { situational: ['war', 'warWinning', 'occupier'], cost: { pctGdp: 1.1 }, pc: 4, confirm: true,
      baseSuccess: 0.64, skills: [['military', 0.18], ['stability', 0.08]],
      warEffect: { warScore: 15, enemyExhaustion: 20, ownExhaustion: 6, casualties: 26_000 },
      warEffectOnFailure: { warScore: -7, ownExhaustion: 12, casualties: 19_000 },
      effects: {
        success: { self: { influence: -6 }, worldTension: 6 },
        failure: { self: { influence: -8, approval: -6 }, worldTension: 5 },
      } }),

  w('relief-column', 'Break Through to Them', 'A corridor to the formation that is cut off. Everything else waits.',
    { situational: ['warLosing', 'occupied', 'war'], cost: { pctGdp: 0.9 }, pc: 3,
      baseSuccess: 0.56, skills: [['readiness', 0.22], ['military', 0.12]],
      warEffect: { warScore: 11, ownExhaustion: -6, casualties: 14_000 },
      warEffectOnFailure: { warScore: -13, ownExhaustion: 12, casualties: 27_000 },
      effects: {
        success: { self: { approval: 6, readiness: 3 } },
        failure: { self: { approval: -9, readiness: -8, unrest: 5 } },
      } }),

  w('elastic-defence', 'Trade Space for Time', 'Give the ground, keep the army, and make every kilometre cost them something.',
    { situational: ['warLosing', 'warExhausted', 'occupied'], cost: { pctGdp: 0.5 }, pc: 2,
      baseSuccess: 0.74, risk: 'medium', skills: [['military', 0.16], ['tech', 0.08]],
      warEffect: { warScore: -4, enemyExhaustion: 13, ownExhaustion: -5, casualties: 8_000 },
      warEffectOnFailure: { warScore: -12, ownExhaustion: 8, casualties: 16_000 },
      effects: {
        success: { self: { readiness: 4, approval: -3 } },
        failure: { self: { readiness: -5, approval: -7, unrest: 5 } },
      } }),

  w('fortify-the-salient', 'Dig In Where You Stand', 'Concrete, wire and interlocking fire. Nobody wins a war doing this and plenty of armies have been saved by it.',
    { situational: ['warStalled', 'warExhausted', 'warLosing'], cost: { pctGdp: 0.6 }, pc: 2,
      baseSuccess: 0.82, risk: 'low', skills: [['military', 0.12], ['stability', 0.08]],
      warEffect: { enemyExhaustion: 6, ownExhaustion: -8 },
      effects: {
        success: { self: { readiness: 4 }, modifier: { label: 'Prepared positions', turns: 8, readiness: 0.25 } },
        failure: { self: { readiness: -1 } },
      } }),

  // ── Deception, tempo and command ──────────────────────────────────────────
  w('deception-plan', 'Run a Deception Plan', 'Dummy formations, false traffic, and a landing everybody is sure is coming somewhere else.',
    { situational: ['war', 'warStalled', 'techLead', 'warWinning'], cost: { pctGdp: 0.4 }, pc: 3,
      covert: true, baseSuccess: 0.58, skills: [['tech', 0.2], ['influence', 0.08]],
      warEffect: { warScore: 13, enemyExhaustion: 6 },
      warEffectOnFailure: { warScore: -5, ownExhaustion: 4 },
      effects: {
        success: { self: { readiness: 2 }, modifier: { label: 'They are looking the wrong way', turns: 3, readiness: 0.4 } },
        failure: { self: { readiness: -2 } },
      } }),

  w('seize-the-initiative', 'Attack Along the Whole Line', 'No schwerpunkt, no reserve, no second chance. Sometimes that is the plan.',
    { situational: ['warWinning', 'warStalled'], cost: { pctGdp: 1.4 }, pc: 4, confirm: true,
      baseSuccess: 0.5, skills: [['military', 0.22], ['readiness', 0.18]],
      warEffect: { warScore: 18, enemyExhaustion: 14, ownExhaustion: 14, casualties: 34_000 },
      warEffectOnFailure: { warScore: -14, ownExhaustion: 20, casualties: 46_000 },
      effects: {
        success: { self: { approval: 6, readiness: -9 } },
        failure: { self: { approval: -10, readiness: -14, unrest: 8 } },
      } }),

  w('relieve-the-commander', 'Relieve the Front Commander', 'Somebody has to answer for the last two quarters. It is either them or you.',
    { situational: ['warLosing', 'warStalled', 'casualties'], cost: { pctGdp: 0.05 }, pc: 2,
      baseSuccess: 0.62, skills: [['stability', 0.16]],
      warEffect: { warScore: 6, ownExhaustion: -4 },
      warEffectOnFailure: { warScore: -6, ownExhaustion: 5 },
      effects: {
        success: { self: { approval: 4, readiness: 3, stability: -1 } },
        failure: { self: { approval: -4, readiness: -5, stability: -4 } },
      } }),

  w('reserve-commitment', 'Commit the Strategic Reserve', 'The last formation you were keeping for the thing that has not happened yet.',
    { situational: ['warLosing', 'warStalled', 'occupied', 'brink'], cost: { pctGdp: 1 }, pc: 4,
      confirm: true, baseSuccess: 0.68, skills: [['readiness', 0.2], ['military', 0.14]],
      warEffect: { warScore: 16, ownExhaustion: 8, casualties: 18_000 },
      warEffectOnFailure: { warScore: -10, ownExhaustion: 16, casualties: 30_000 },
      effects: {
        success: { self: { readiness: -10, approval: 3 } },
        failure: { self: { readiness: -16, approval: -8, unrest: 6 } },
      } }),

  // ── Sea, air and the far side ─────────────────────────────────────────────
  w('convoy-escort', 'Escort the Convoys', 'Your economy arrives by sea or it does not arrive. Somebody has to sit on that route.',
    { situational: ['war', 'maritime', 'exporter', 'warLosing'], cost: { pctGdp: 0.7 }, pc: 2,
      baseSuccess: 0.74, risk: 'medium', skills: [['military', 0.14], ['tech', 0.12]],
      warEffect: { ownExhaustion: -7 },
      effects: {
        success: { self: { readiness: 3 }, modifier: { label: 'Sea lines held', turns: 8, growth: 0.18 } },
        failure: { self: { readiness: -4 }, modifier: { label: 'Shipping losses', turns: 5, growth: -0.3 } },
      } }),

  w('mine-the-approaches', 'Mine the Approaches', 'Cheap, indiscriminate, and it will still be killing fishermen in twenty years.',
    { situational: ['war', 'maritime', 'warLosing', 'occupied'], cost: { pctGdp: 0.4 }, pc: 2,
      baseSuccess: 0.78, skills: [['tech', 0.14], ['military', 0.08]],
      warEffect: { warScore: 7, enemyExhaustion: 10 },
      effects: {
        success: { self: { influence: -3 }, worldTension: 4 },
        failure: { self: { influence: -4, readiness: -2 }, worldTension: 3 },
      } }),

  w('suppress-air-defence', 'Roll Back Their Air Defence', 'Two weeks of losses to buy the sky, and everything afterwards is easier.',
    { situational: ['war', 'techLead', 'warStalled', 'strongArmy'], cost: { pctGdp: 1.2 }, pc: 3,
      baseSuccess: 0.62, skills: [['tech', 0.24], ['readiness', 0.1]],
      warEffect: { warScore: 12, enemyExhaustion: 12, casualties: 8_000 },
      warEffectOnFailure: { ownExhaustion: 9, casualties: 12_000 },
      effects: {
        success: { self: { readiness: 4 }, modifier: { label: 'Air superiority', turns: 6, readiness: 0.45 } },
        failure: { self: { readiness: -6, approval: -4 } },
      } }),

  w('rail-repair', 'Repair the Railheads', 'An army moves at the speed of its worst bridge. Fix the bridge.',
    { situational: ['war', 'occupier', 'warStalled', 'warWinning'], cost: { pctGdp: 0.5 }, pc: 1,
      baseSuccess: 0.84, risk: 'low', skills: [['tech', 0.12], ['stability', 0.08]],
      warEffect: { warScore: 5, ownExhaustion: -8 },
      effects: {
        success: { self: { readiness: 5 }, modifier: { label: 'Supply restored', turns: 6, readiness: 0.3 } },
        failure: { self: { readiness: -1 } },
      } }),

  // ── People, law and the ground you hold ───────────────────────────────────
  w('declare-war-aims', 'Declare Your War Aims', 'Say publicly what would end it. It binds you, and it is the only thing that ever shortens one of these.',
    { situational: ['war', 'warStalled', 'warExhausted', 'casualties'], cost: { pctGdp: 0.05 }, pc: 3,
      baseSuccess: 0.7, risk: 'medium', skills: [['influence', 0.2], ['approval', 0.1]],
      warEffect: { enemyExhaustion: 8 },
      effects: {
        success: { self: { approval: 7, influence: 4, unrest: -4 }, worldTension: -4 },
        failure: { self: { approval: -5, influence: -3 }, worldTension: 2 },
      } }),

  w('prisoner-policy', 'Set the Prisoner Policy', 'Registers, inspections, the correct conventions. It costs you nothing and it is the file that gets read at the tribunal.',
    { situational: ['war', 'occupier', 'casualties'], cost: { pctGdp: 0.15 }, pc: 1,
      baseSuccess: 0.82, risk: 'low', skills: [['stability', 0.14], ['influence', 0.1]],
      effects: {
        success: { self: { influence: 5, approval: 2 }, worldTension: -2 },
        failure: { self: { influence: -5, approval: -3 }, worldTension: 2 },
      } }),

  w('requisition', 'Requisition What You Need', 'Trucks, fuel, warehouses, the harvest. Paid for in paper nobody expects to be honoured.',
    { situational: ['war', 'warLosing', 'occupier', 'tight'], cost: { pctGdp: 0.1 }, pc: 3,
      baseSuccess: 0.76, skills: [['stability', 0.16]],
      warEffect: { ownExhaustion: -9 },
      effects: {
        success: { self: { readiness: 7, unrest: 7, approval: -5, treasuryPctGdp: 0.8 } },
        failure: { self: { unrest: 12, approval: -9, stability: -4, readiness: 2 } },
      } }),

  w('screen-the-occupied', 'Screen the Occupied Districts', 'House to house, list in hand. It finds the network and it makes ten more.',
    { situational: ['occupier', 'conquest', 'attack'], cost: { pctGdp: 0.4 }, pc: 3, confirm: true,
      baseSuccess: 0.66, skills: [['stability', 0.16], ['tech', 0.08]],
      effects: {
        success: { self: { stability: 4, unrest: 4, influence: -4 },
          modifier: { label: 'Pacified districts', turns: 8, unrest: -0.2 } },
        failure: { self: { unrest: 11, influence: -8, stability: -3 },
          modifier: { label: 'Insurgency deepening', turns: 8, unrest: 0.7, growth: -0.2 } },
      } }),

  w('feed-the-occupied', 'Feed the Districts You Hold', 'Grain, fuel and clinics for people who did not ask for you. It is cheaper than a garrison.',
    { situational: ['occupier', 'conquest', 'famine'], cost: { pctGdp: 0.8 }, pc: 2,
      baseSuccess: 0.78, risk: 'medium', skills: [['stability', 0.14], ['influence', 0.12]],
      effects: {
        success: { self: { influence: 5, unrest: -3, approval: -2 },
          modifier: { label: 'Quiet occupation', turns: 10, unrest: -0.35 } },
        failure: { self: { approval: -4, influence: -1 } },
      } }),

  w('exchange-the-dead', 'Exchange the Dead', 'A truce of a few hours on one sector, and two lists nobody wants to read.',
    { situational: ['casualties', 'war', 'warStalled'], cost: { pctGdp: 0.03 }, pc: 1,
      baseSuccess: 0.86, risk: 'low', skills: [['influence', 0.14]],
      warEffect: { ownExhaustion: -3, enemyExhaustion: -3 },
      effects: {
        success: { self: { approval: 5, unrest: -4, influence: 2 }, worldTension: -2 },
        failure: { self: { approval: -2 } },
      } }),

  w('mobilise-the-reserves', 'Call Up the Next Class', 'Another two hundred thousand. Everybody knows somebody in it.',
    { situational: ['warLosing', 'war', 'occupied', 'brink'], cost: { pctGdp: 0.7 }, pc: 3,
      baseSuccess: 0.72, skills: [['stability', 0.16], ['approval', 0.08]],
      warEffect: { warScore: 8, ownExhaustion: 4 },
      effects: {
        success: { self: { readiness: 10, military: 3, unrest: 7, approval: -5 } },
        failure: { self: { unrest: 14, approval: -10, stability: -5, readiness: 3 } },
      } }),

  // ── Fighting alongside somebody ───────────────────────────────────────────
  w('joint-command-with-ally', 'Put It Under Joint Command', 'One headquarters for two armies. Somebody has to take orders and neither of you wants it to be you.',
    { situational: ['war', 'warStalled', 'warLosing'], cost: { pctGdp: 0.2 }, pc: 3,
      target: 'nation', baseSuccess: 0.6, skills: [['influence', 0.16], ['military', 0.12]],
      warEffect: { warScore: 10, ownExhaustion: -6 },
      warEffectOnFailure: { warScore: -5, ownExhaustion: 5 },
      effects: {
        success: { self: { readiness: 6, influence: 2 }, relation: 14,
          modifier: { label: 'Combined command', turns: 10, readiness: 0.4 } },
        failure: { self: { readiness: -4 }, relation: -6 },
      } }),

  w('request-reinforcement', 'Ask Them for Divisions', 'Not materiel. Formations, with their own flags on them, standing on your ground.',
    { situational: ['warLosing', 'occupied', 'war'], cost: { pctGdp: 0.1 }, pc: 4,
      target: 'nation', baseSuccess: 0.5, risk: 'high', skills: [['influence', 0.24]],
      warEffect: { warScore: 13, ownExhaustion: -10 },
      effects: {
        success: { self: { readiness: 8, influence: -2, approval: 3 }, relation: 10 },
        failure: { self: { influence: -5, approval: -5 }, relation: -8 },
      } }),

  w('lend-lease', 'Lend-Lease', 'Everything they need, now, on terms to be settled after somebody wins.',
    { situational: ['warNextDoor', 'war', 'rich', 'strongArmy'], cost: { pctGdp: 1.5 }, pc: 3,
      target: 'nation', baseSuccess: 0.8, risk: 'medium', skills: [['influence', 0.14]],
      effects: {
        success: {
          self: { influence: 6, readiness: -3, approval: -2 },
          target: { readiness: 9, military: 3 }, relation: 26, worldTension: 5,
        },
        failure: { self: { approval: -5, influence: -2 }, relation: 6, worldTension: 3 },
      } }),
];

/** Whether the War Room should be on the tab strip at all. */
export function warRoomOpen(game) {
  return activeWarsFor(game, game.playerId).length > 0;
}
