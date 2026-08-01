// The new-game screen: how to play, which world, which country, how hard, how
// it looks, and (optionally) which free AI provider.

import { REGIONS, playableNations, powerRank } from '../data/nations.js';
import { DIFFICULTY_MAX, DIFFICULTY_MIN, difficultyModifiers, difficultyPreview } from '../engine/difficulty.js';
import { WORLD_MODES, modePreview } from '../engine/worldmodes.js';
import { PROVIDERS, PROVIDERS_BY_ID } from '../ai/providers.js';
import { AiClient } from '../ai/client.js';
import { h, mount } from './dom.js';
import { THEMES, UI_SCALES, applyTheme, applyUiScale } from './theme.js';
import { hasSave, loadAiConfig, loadPrefs, saveAiConfig, savePrefs } from './store.js';

export class SetupScreen {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    const prefs = loadPrefs();
    this.state = {
      nationId: prefs.lastNation,
      difficulty: prefs.lastDifficulty,
      totalTurns: prefs.lastLength,
      worldMode: prefs.lastWorldMode,
      theme: prefs.theme,
      uiScale: prefs.uiScale,
      seed: '',
      search: '',
      region: 'all',
      ai: loadAiConfig(),
      testStatus: null,
    };
  }

  render() {
    mount(
      this.root,
      h('div.setup',
        this.#hero(),
        this.#quickstart(),
        h('div.setup__grid',
          h('section.panel.panel--wide',
            h('h2.panel__title', 'Choose your country'),
            this.#countryFilters(),
            this.#countryGrid(),
          ),
          h('div.setup__side',
            this.#worldModePanel(),
            this.#difficultyPanel(),
            this.#appearancePanel(),
            this.#rulesPanel(),
            this.#aiPanel(),
            this.#startPanel(),
          ),
        ),
      ),
    );
  }

  #hero() {
    return h('header.hero',
      h('div.hero__mark', 'PAX'),
      h('div',
        h('h1.hero__title', 'Pax Sophistc'),
        h('p.hero__sub',
          'Run any country on earth from 2026 onward. Choose the world you want to play in, ',
          'set how hard it pushes back, and see how far you get. Runs entirely in your browser; ',
          'free AI narration optional.',
        ),
      ),
    );
  }

  #quickstart() {
    return h('section.panel', { style: { marginBottom: '1.25rem' } },
      h('h2.panel__title', 'How it works'),
      h('div.quickstart',
        h('div.quickstart__step',
          h('div.quickstart__num', '1'),
          h('div.quickstart__text', h('strong', 'Pick a country.'), ' Anything from the United States to Cuba. Each one starts from its real 2026 position.'),
        ),
        h('div.quickstart__step',
          h('div.quickstart__num', '2'),
          h('div.quickstart__text', h('strong', 'Issue up to four orders'), ' each quarter — spend money and political capital on the economy, the army, diplomacy or your own population.'),
        ),
        h('div.quickstart__step',
          h('div.quickstart__num', '3'),
          h('div.quickstart__text', h('strong', 'The world answers.'), ' Fifty-five other governments move, crises land on your desk, and you get a briefing on what changed.'),
        ),
        h('div.quickstart__step',
          h('div.quickstart__num', '4'),
          h('div.quickstart__text', h('strong', 'Get graded.'), ' At the end of your term you are scored against the mandate you were handed on day one.'),
        ),
      ),
    );
  }

  #worldModePanel() {
    return h('section.panel',
      h('h2.panel__title', 'World'),
      h('div.mode-cards',
        WORLD_MODES.map((mode) =>
          h('button.mode-card', {
            class: this.state.worldMode === mode.id ? 'mode-card is-active' : 'mode-card',
            onclick: () => { this.state.worldMode = mode.id; this.render(); },
            'aria-pressed': String(this.state.worldMode === mode.id),
          },
            h('div.mode-card__head',
              h('span.mode-card__icon', mode.icon),
              h('span.mode-card__name', mode.name),
            ),
            h('div.mode-card__blurb', mode.blurb),
            h('div.mode-card__traits', mode.traits.map((t) => h('span.badge', t))),
            this.state.worldMode === mode.id
              ? h('ul.difficulty__list', { style: { marginTop: '0.5rem' } },
                  modePreview(mode.id).map((line) => h('li', line)))
              : null,
          ),
        ),
      ),
    );
  }

  #countryFilters() {
    return h('div.filters',
      h('input.input.filters__search', {
        type: 'search',
        placeholder: 'Search 56 countries…',
        value: this.state.search,
        oninput: (e) => { this.state.search = e.target.value; this.#refreshGrid(); },
      }),
      h('div.chips',
        h('button.chip', {
          class: this.state.region === 'all' ? 'chip is-active' : 'chip',
          onclick: () => { this.state.region = 'all'; this.render(); },
        }, 'All regions'),
        REGIONS.map((r) =>
          h('button.chip', {
            class: this.state.region === r.id ? 'chip is-active' : 'chip',
            onclick: () => { this.state.region = r.id; this.render(); },
          }, r.name),
        ),
      ),
    );
  }

  #visibleNations() {
    const q = this.state.search.trim().toLowerCase();
    return playableNations().filter((n) => {
      if (this.state.region !== 'all' && n.region !== this.state.region) return false;
      if (!q) return true;
      return (
        n.name.toLowerCase().includes(q) ||
        n.adjective.toLowerCase().includes(q) ||
        n.id.includes(q) ||
        n.tags.some((t) => t.includes(q))
      );
    });
  }

  #countryGrid() {
    const grid = h('div.country-grid');
    this.gridEl = grid;
    this.#fillGrid(grid);
    return grid;
  }

  #refreshGrid() {
    if (this.gridEl) this.#fillGrid(this.gridEl);
  }

  #fillGrid(grid) {
    const nations = this.#visibleNations();
    mount(grid, nations.length
      ? nations.map((n) => this.#countryCard(n))
      : h('p.empty', 'No country matches that search.'));
  }

  #countryCard(nation) {
    const selected = nation.id === this.state.nationId;
    const tier = powerRank(nation);
    const label =
      tier >= 155 ? 'Superpower'
      : tier >= 120 ? 'Great power'
      : tier >= 100 ? 'Major power'
      : tier >= 84 ? 'Regional power'
      : tier >= 74 ? 'Middle power'
      : 'Small power';

    const ease = countryEase(nation);

    return h('button.country', {
      class: selected ? 'country is-selected' : 'country',
      onclick: () => { this.state.nationId = nation.id; this.render(); },
      'aria-pressed': String(selected),
    },
      h('div.country__head',
        h('span.country__flag', nation.flag),
        h('div',
          h('div.country__name', nation.name),
          h('div.country__tier', `${label} · ${nation.government}`),
        ),
      ),
      h('p.country__brief', nation.brief),
      h('div.country__stats',
        h('span.country__ease', { style: { color: ease.colour }, title: ease.hint }, ease.label),
        stat('GDP', `$${nation.gdp.toFixed(2)}T`),
        stat('Pop', `${nation.population}M`),
        stat('Mil', nation.military),
        stat('Stab', nation.stability),
        nation.nukes > 0 ? stat('Nukes', nation.nukes) : null,
      ),
    );
  }

  #difficultyPanel() {
    const mods = difficultyModifiers(this.state.difficulty);
    return h('section.panel',
      h('h2.panel__title', 'Difficulty'),
      h('div.difficulty',
        h('div.difficulty__head',
          h('span.difficulty__tier', mods.tier.name),
          h('span.difficulty__value', `${this.state.difficulty} / ${DIFFICULTY_MAX}`),
        ),
        h('input.slider', {
          type: 'range',
          min: DIFFICULTY_MIN, max: DIFFICULTY_MAX, step: 1,
          value: this.state.difficulty,
          'aria-label': 'Difficulty',
          oninput: (e) => { this.state.difficulty = Number(e.target.value); this.render(); },
        }),
        h('div.slider__scale', h('span', 'Détente'), h('span', 'Contested'), h('span', 'Doomsday')),
        h('p.difficulty__blurb', mods.tier.blurb),
        h('ul.difficulty__list', difficultyPreview(this.state.difficulty).map((line) => h('li', line))),
      ),
    );
  }

  #appearancePanel() {
    return h('section.panel',
      h('h2.panel__title', 'Appearance'),
      h('div.theme-grid',
        THEMES.map((theme) =>
          h('button.theme-card', {
            class: this.state.theme === theme.id ? 'theme-card is-active' : 'theme-card',
            title: theme.blurb,
            onclick: () => {
              this.state.theme = theme.id;
              applyTheme(theme.id);
              savePrefs({ theme: theme.id });
              this.render();
            },
          },
            h('div.theme-card__swatches',
              theme.swatch.map((colour) => h('span.theme-card__swatch', { style: { background: colour } }))),
            h('div.theme-card__name', theme.name),
          ),
        ),
      ),
      h('label.field', { style: { marginTop: '0.75rem', marginBottom: 0 } },
        h('span.field__label', 'Text size'),
        h('div.chips',
          UI_SCALES.map((scale) =>
            h('button.chip', {
              class: this.state.uiScale === scale.id ? 'chip is-active' : 'chip',
              onclick: () => {
                this.state.uiScale = scale.id;
                applyUiScale(scale.id);
                savePrefs({ uiScale: scale.id });
                this.render();
              },
            }, scale.name),
          ),
        ),
      ),
    );
  }

  #rulesPanel() {
    return h('section.panel',
      h('h2.panel__title', 'Run settings'),
      h('label.field',
        h('span.field__label', 'Length of term'),
        h('select.input', { onchange: (e) => { this.state.totalTurns = Number(e.target.value); } },
          [[16, '4 years (16 quarters)'], [40, '10 years (40 quarters)'], [80, '20 years (80 quarters)']].map(
            ([value, label]) => h('option', { value, selected: this.state.totalTurns === value }, label)),
        ),
      ),
      h('label.field',
        h('span.field__label', 'Seed (optional)'),
        h('input.input', {
          type: 'text',
          placeholder: 'Leave blank for random',
          value: this.state.seed,
          oninput: (e) => { this.state.seed = e.target.value; },
        }),
        h('span.field__hint', 'The same seed and the same orders replay the same world.'),
      ),
    );
  }

  #aiPanel() {
    const provider = PROVIDERS_BY_ID[this.state.ai.providerId] || PROVIDERS[0];
    const isOffline = provider.kind === 'none';

    return h('section.panel',
      h('h2.panel__title', 'AI narrator (optional)'),
      h('p.panel__note',
        'The game is fully playable without this. A language model writes the briefings, judges ',
        'freeform orders and answers your advisers. Every option below has a free tier.',
      ),
      h('label.field',
        h('span.field__label', 'Provider'),
        h('select.input', {
          onchange: (e) => {
            const next = PROVIDERS_BY_ID[e.target.value];
            this.state.ai.providerId = next.id;
            this.state.ai.model = next.defaultModel || '';
            this.state.testStatus = null;
            this.#persistAi();
            this.render();
          },
        },
          PROVIDERS.map((p) => h('option', { value: p.id, selected: p.id === provider.id }, p.label)),
        ),
        h('span.field__hint', provider.blurb),
      ),

      isOffline ? null : h('label.field',
        h('span.field__label', provider.requiresKey ? 'API key' : 'API key (optional)'),
        h('input.input', {
          type: 'password', autocomplete: 'off', spellcheck: 'false',
          placeholder: provider.requiresKey ? 'Paste your free API key' : 'Usually blank for local servers',
          value: this.state.ai.apiKey,
          oninput: (e) => { this.state.ai.apiKey = e.target.value.trim(); this.#persistAi(); },
        }),
        provider.signupUrl
          ? h('span.field__hint', 'Get one free at ',
              h('a', { href: provider.signupUrl, target: '_blank', rel: 'noreferrer noopener' },
                provider.signupUrl.replace(/^https?:\/\//, '')),
              '. It is stored in this browser only and sent straight to the provider.')
          : null,
      ),

      isOffline ? null : h('label.field',
        h('span.field__label', 'Model'),
        h('input.input', {
          type: 'text',
          list: `models-${provider.id}`,
          value: this.state.ai.model || provider.defaultModel || '',
          oninput: (e) => { this.state.ai.model = e.target.value.trim(); this.#persistAi(); },
        }),
        provider.models.length
          ? h('datalist', { id: `models-${provider.id}` }, provider.models.map((m) => h('option', { value: m })))
          : null,
      ),

      provider.id === 'custom'
        ? h('label.field',
            h('span.field__label', 'Endpoint URL'),
            h('input.input', {
              type: 'url',
              placeholder: 'http://localhost:8080/v1/chat/completions',
              value: this.state.ai.endpoint,
              oninput: (e) => { this.state.ai.endpoint = e.target.value.trim(); this.#persistAi(); },
            }),
          )
        : null,

      isOffline
        ? h('p.panel__note.panel__note--ok',
            'Offline mode works: briefings are written by a local generator instead. You can add a key later from Settings.')
        : h('div.row',
            h('button.btn.btn--ghost', { onclick: (e) => this.#testConnection(e.currentTarget) }, 'Test connection'),
            this.state.testStatus
              ? h('span.status', { class: `status status--${this.state.testStatus.kind}` }, this.state.testStatus.message)
              : null,
          ),
    );
  }

  async #testConnection(button) {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Testing…';
    this.state.testStatus = null;
    try {
      const reply = await new AiClient({ ...this.state.ai, enabled: true }).test();
      this.state.testStatus = { kind: 'ok', message: `Connected. Model replied "${reply}".` };
    } catch (err) {
      this.state.testStatus = { kind: 'bad', message: err.message || 'Connection failed.' };
    } finally {
      button.disabled = false;
      button.textContent = original;
      this.render();
    }
  }

  #persistAi() {
    saveAiConfig(this.state.ai);
  }

  #startPanel() {
    return h('section.panel.panel--start',
      h('button.btn.btn--primary.btn--block.btn--lg', {
        onclick: () => this.handlers.onStart({
          playerNationId: this.state.nationId,
          difficulty: this.state.difficulty,
          totalTurns: this.state.totalTurns,
          mode: this.state.worldMode,
          seed: this.state.seed.trim() || null,
          ai: this.state.ai,
        }),
      }, 'Take office'),
      hasSave()
        ? h('button.btn.btn--ghost.btn--block', { onclick: () => this.handlers.onContinue() }, 'Continue saved run')
        : null,
      h('label.btn.btn--ghost.btn--block.btn--file',
        'Load a save file',
        h('input', {
          type: 'file', accept: 'application/json,.json',
          onchange: (e) => {
            const file = e.target.files?.[0];
            if (file) this.handlers.onImport(file);
          },
        }),
      ),
    );
  }
}

/** A rough "how forgiving is this country to play" read, for newcomers. */
export function countryEase(nation) {
  const score =
    nation.stability * 0.5 +
    (100 - nation.unrest) * 0.25 +
    Math.min(100, Math.log10(Math.max(nation.gdp, 0.01) * 1000) * 22) * 0.25;

  if (score >= 68) return { label: 'Gentle start', colour: 'var(--good)', hint: 'Stable, solvent, few enemies. A good first run.' };
  if (score >= 54) return { label: 'Moderate', colour: 'var(--warn)', hint: 'Real problems, but room to manoeuvre.' };
  return { label: 'Hard start', colour: 'var(--bad)', hint: 'Fragile, poor, or surrounded. Expect to struggle.' };
}

function stat(label, value) {
  return h('div.microstat', h('span.microstat__label', label), h('span.microstat__value', String(value)));
}
