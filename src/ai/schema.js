// The model is a narrator and an adjudicator; it is never allowed to be the
// rules engine. Anything it returns passes through here and comes out clamped
// into a shape the simulation can safely apply.

const STAT_LIMIT = 12;
const RELATION_LIMIT = 35;
const TENSION_LIMIT = 14;

function num(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value, maxLength = 400, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

function sanitizeStatBlock(block) {
  if (!block || typeof block !== 'object') return undefined;
  const out = {};
  for (const key of ['military', 'readiness', 'tech', 'stability', 'influence', 'unrest', 'approval']) {
    if (typeof block[key] === 'number' && block[key] !== 0) {
      out[key] = num(block[key], -STAT_LIMIT, STAT_LIMIT);
    }
  }
  if (typeof block.gdpPct === 'number') out.gdpPct = num(block.gdpPct, -4, 4);
  if (typeof block.treasuryPctGdp === 'number') out.treasuryPctGdp = num(block.treasuryPctGdp, -3, 3);
  return Object.keys(out).length ? out : undefined;
}

function sanitizeModifier(mod, label) {
  if (!mod || typeof mod !== 'object') return undefined;
  const out = {
    label: str(mod.label, 60, label),
    turns: Math.round(num(mod.turns, 1, 10, 4)),
    growth: num(mod.growth, -0.6, 0.6),
    stability: num(mod.stability, -1.5, 1.5),
    unrest: num(mod.unrest, -2, 2),
    source: 'custom',
  };
  const meaningful = out.growth || out.stability || out.unrest;
  return meaningful ? out : undefined;
}

function sanitizeEffect(effect, fallbackLabel) {
  if (!effect || typeof effect !== 'object') return null;
  const out = {};
  const self = sanitizeStatBlock(effect.self);
  const target = sanitizeStatBlock(effect.target);
  if (self) out.self = self;
  if (target) out.target = target;
  if (typeof effect.relation === 'number') out.relation = num(effect.relation, -RELATION_LIMIT, RELATION_LIMIT);
  if (typeof effect.worldTension === 'number') {
    out.worldTension = num(effect.worldTension, -TENSION_LIMIT, TENSION_LIMIT);
  }
  const modifier = sanitizeModifier(effect.modifier, fallbackLabel);
  if (modifier) out.modifier = modifier;
  const targetModifier = sanitizeModifier(effect.targetModifier, fallbackLabel);
  if (targetModifier) out.targetModifier = targetModifier;
  return Object.keys(out).length ? out : null;
}

const VALID_CATEGORIES = ['economy', 'military', 'diplomacy', 'domestic', 'intelligence', 'technology'];
const VALID_SKILLS = ['military', 'readiness', 'tech', 'stability', 'influence', 'approval'];

/**
 * Turn a model's judgement of a freeform order into a real action definition.
 *
 * @param {object} raw
 * @param {{validNationIds: Set<string>, playerId: string, orderText: string}} ctx
 */
export function sanitizeCustomAction(raw, ctx) {
  if (!raw || typeof raw !== 'object') return null;

  const feasible = raw.feasible !== false;
  const label = str(raw.name, 70) || truncateOrder(ctx.orderText);
  const category = VALID_CATEGORIES.includes(raw.category) ? raw.category : 'diplomacy';

  let targetId = null;
  if (typeof raw.targetId === 'string') {
    const candidate = raw.targetId.trim().toLowerCase();
    if (ctx.validNationIds.has(candidate) && candidate !== ctx.playerId) targetId = candidate;
  }

  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .filter((s) => VALID_SKILLS.includes(s?.stat))
        .slice(0, 3)
        .map((s) => [s.stat, num(s.weight, 0, 0.35, 0.15)])
    : [['influence', 0.15]];

  const success = sanitizeEffect(raw.onSuccess, label) || { self: { influence: 1 } };
  const failure = sanitizeEffect(raw.onFailure, label) || { self: { approval: -2 } };
  const backfire = sanitizeEffect(raw.onBackfire, label);

  const action = {
    id: 'custom-order',
    name: label,
    category,
    blurb: str(raw.rationale, 300, 'A freeform order adjudicated by your advisors.'),
    cost: { pctGdp: num(raw.costPctGdp, 0, 4, 0.5) },
    pc: Math.round(num(raw.politicalCapital, 1, 5, 2)),
    target: targetId ? 'nation' : 'none',
    baseSuccess: num(raw.successChance, 0.12, 0.88, 0.55),
    risk: ['low', 'medium', 'high'].includes(raw.risk) ? raw.risk : 'medium',
    skills,
    effects: { success, failure, ...(backfire ? { backfire } : {}) },
  };

  return {
    feasible,
    action,
    targetId,
    rationale: str(raw.rationale, 400, ''),
    refusal: feasible ? null : str(raw.rationale, 400, 'Your advisors say this cannot be done.'),
  };
}

function truncateOrder(text) {
  const clean = String(text || 'Freeform order').replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

/** Validate the narrator's briefing payload. */
export function sanitizeBriefing(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dispatches = Array.isArray(raw.dispatches)
    ? raw.dispatches
        .slice(0, 5)
        .map((d) => ({
          source: str(d?.source, 60, 'Wire service'),
          text: str(d?.text, 600, ''),
        }))
        .filter((d) => d.text)
    : [];

  const briefing = Array.isArray(raw.briefing)
    ? raw.briefing.map((p) => str(p, 900)).filter(Boolean).slice(0, 5)
    : [str(raw.briefing, 1800)].filter(Boolean);

  const headline = str(raw.headline, 140);
  if (!headline && !briefing.length && !dispatches.length) return null;

  return {
    headline: headline || 'The quarter closes',
    briefing,
    dispatches,
    advisorNote: str(raw.advisorNote, 500, ''),
    outlook: str(raw.outlook, 300, ''),
  };
}
