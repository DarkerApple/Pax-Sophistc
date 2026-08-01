// The narration layer. Tries the configured free provider; falls back to a
// local generator so the game is fully playable with no key, no network, and no
// account.

import { AiClient } from './client.js';
import {
  adjudicatorSystemPrompt,
  advisorSystemPrompt,
  buildAdjudicatorPrompt,
  buildAdvisorPrompt,
  buildNarratorPrompt,
  buildOpeningPrompt,
  narratorSystemPrompt,
  openingSystemPrompt,
} from './prompts.js';
import { sanitizeBriefing, sanitizeCustomAction } from './schema.js';
import { offlineBriefing, offlineOpening } from './offline.js';

export class Narrator {
  constructor(config) {
    this.client = new AiClient(config);
    this.lastError = null;
  }

  update(config) {
    this.client = new AiClient(config);
  }

  get usingAi() {
    return !this.client.isOffline;
  }

  /** Quarterly briefing. Always resolves — never lets an API failure end a run. */
  async briefing(game, report) {
    if (!this.usingAi) return { ...offlineBriefing(game, report), source: 'offline' };
    try {
      const raw = await this.client.completeJson({
        system: narratorSystemPrompt(),
        user: buildNarratorPrompt(game, report),
        maxTokens: 1200,
      });
      const clean = sanitizeBriefing(raw);
      if (!clean) throw new Error('empty briefing');
      this.lastError = null;
      return { ...clean, source: 'ai' };
    } catch (err) {
      this.lastError = err;
      return { ...offlineBriefing(game, report), source: 'offline', degraded: describeError(err) };
    }
  }

  async opening(game) {
    if (!this.usingAi) return { ...offlineOpening(game), source: 'offline' };
    try {
      const raw = await this.client.completeJson({
        system: openingSystemPrompt(),
        user: buildOpeningPrompt(game),
        maxTokens: 1000,
      });
      const clean = sanitizeBriefing(raw);
      if (!clean) throw new Error('empty opening');
      this.lastError = null;
      return { ...clean, source: 'ai' };
    } catch (err) {
      this.lastError = err;
      return { ...offlineOpening(game), source: 'offline', degraded: describeError(err) };
    }
  }

  /**
   * Price and shape a freeform order.
   * Without a provider, falls back to a conservative generic order so the
   * freeform box still does something sensible offline.
   */
  async adjudicate(game, orderText) {
    const ctx = {
      validNationIds: new Set(Object.keys(game.nations)),
      playerId: game.playerId,
      orderText,
    };

    if (!this.usingAi) return { ...offlineAdjudication(orderText), source: 'offline' };

    try {
      const raw = await this.client.completeJson({
        system: adjudicatorSystemPrompt(),
        user: buildAdjudicatorPrompt(game, orderText),
        maxTokens: 900,
        temperature: 0.5,
      });
      const clean = sanitizeCustomAction(raw, ctx);
      if (!clean) throw new Error('unparseable adjudication');
      this.lastError = null;
      return { ...clean, source: 'ai' };
    } catch (err) {
      this.lastError = err;
      return { ...offlineAdjudication(orderText), source: 'offline', degraded: describeError(err) };
    }
  }

  async askAdvisor(game, question) {
    if (!this.usingAi) {
      return {
        text: 'Your advisers can only speak when an AI provider is configured. Open Settings and add a free API key — or keep playing; the simulation does not need one.',
        source: 'offline',
      };
    }
    try {
      const text = await this.client.complete({
        system: advisorSystemPrompt(),
        user: buildAdvisorPrompt(game, question),
        maxTokens: 400,
      });
      this.lastError = null;
      return { text: text.trim(), source: 'ai' };
    } catch (err) {
      this.lastError = err;
      return { text: `Your adviser could not be reached: ${describeError(err)}`, source: 'error' };
    }
  }
}

function describeError(err) {
  if (!err) return 'unknown error';
  if (err.kind === 'auth') return 'the API key was rejected';
  if (err.kind === 'rate-limit') return 'the free-tier rate limit was hit';
  if (err.kind === 'network') return 'the provider could not be reached';
  if (err.kind === 'model') return 'that model name was not recognised';
  return err.message || 'unknown error';
}

/** A deliberately cautious generic order, used when no model is available. */
function offlineAdjudication(orderText) {
  const text = String(orderText || '').trim();
  const name = text.length > 58 ? `${text.slice(0, 55)}…` : text || 'Freeform order';
  return {
    feasible: true,
    targetId: null,
    rationale:
      'Adjudicated locally without a language model: priced as a moderate, general-purpose initiative. Configure a free AI provider for orders that are read properly.',
    refusal: null,
    action: {
      id: 'custom-order',
      name,
      category: 'diplomacy',
      blurb: 'Freeform order, locally adjudicated.',
      cost: { pctGdp: 0.6 },
      pc: 2,
      target: 'none',
      baseSuccess: 0.55,
      risk: 'medium',
      skills: [['influence', 0.15], ['stability', 0.1]],
      effects: {
        success: { self: { influence: 2, approval: 2 } },
        failure: { self: { approval: -2 } },
      },
    },
  };
}

