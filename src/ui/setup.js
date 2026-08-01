// The new-game screen: pick a country, set the difficulty, wire up a free AI
// provider (or don't).

import { NATIONS, REGIONS, playableNations, powerRank } from '../data/nations.js';
import { DIFFICULTY_MAX, DIFFICULTY_MIN, difficultyModifiers, difficultyPreview } from '../engine/difficulty.js';
import { PROVIDERS, PROVIDERS_BY_ID } from '../ai/providers.js';
import { AiClient } from '../ai/client.js';
import { h, mount } from './dom.js';
import { hasSave, loadAiConfig, loadPrefs, saveAiConfig } from './store.js';

export class SetupScreen {
  /**
   * @param {HTMLElement} root
   * @param {{onStart: Function, onContinue: Function, onImport: Function}} handlers
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    const prefs = loadPrefs();
    this.state = {
      nationId: prefs.lastNation,
      difficulty: prefs.lastDifficulty,
      totalTurns: prefs.lastLength,
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
        h('div.setup__grid',
          h('section.panel.panel--wide',
            h('h2.panel__title', 'Choose your country'),
            this.#countryFilters(),
            this.#countryGrid(),
          ),
          h('div.setup__side',
            this.#difficultyPanel(),
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
          'Current World — Q1 2026. Take charge of any country on earth, set the difficulty, and see how ',
          'far you get across the next decade. Runs entirely in your browser; free AI providers optional.',
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
        oninput: (e) => {
          this.state.search = e.target.value;
          this.#refreshGrid();
        },
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
    mount(
      grid,
      nations.length
        ? nations.map((n) => this.#countryCard(n))
        : h('p.empty', 'No country matches that search.'),
    );
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

    return h('button.country', {
      class: selected ? 'country is-selected' : 'country',
      onclick: () => {
        this.state.nationId = nation.id;
        this.render();
      },
      'aria-pressed': String(selected),
    },
      h('div.country__head',
        h('span.country__flag', nation.flag),
        h('div',
          h('div.country__name', nation.name),
          h('div.country__tier', label, ' · ', nation.government),
        ),
      ),
      h('p.country__brief', nation.brief),
      h('div.country__stats',
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
          min: DIFFICULTY_MIN,
          max: DIFFICULTY_MAX,
          step: 1,
          value: this.state.difficulty,
          'aria-label': 'Difficulty',
          oninput: (e) => {
            this.state.difficulty = Number(e.target.value);
            this.render();
          },
        }),
        h('div.slider__scale',
          h('span', 'Détente'),
          h('span', 'Contested'),
          h('span', 'Doomsday'),
        ),
        h('p.difficulty__blurb', mods.tier.blurb),
        h('ul.difficulty__list',
          difficultyPreview(this.state.difficulty).map((line) => h('li', line)),
        ),
      ),
    );
  }

  #rulesPanel() {
    return h('section.panel',
      h('h2.panel__title', 'Run settings'),
      h('label.field',
        h('span.field__label', 'Length of term'),
        h('select.input', {
          onchange: (e) => { this.state.totalTurns = Number(e.target.value); },
        },
          [[16, '4 years (16 quarters)'], [40, '10 years (40 quarters)'], [80, '20 years (80 quarters)']].map(
            ([value, label]) =>
              h('option', { value, selected: this.state.totalTurns === value }, label),
          ),
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
      h('h2.panel__title', 'AI narrator'),
      h('p.panel__note',
        'The simulation is fully local. A language model writes the briefings, judges freeform orders, ',
        'and answers your advisers. Every option below has a free tier.',
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
          PROVIDERS.map((p) =>
            h('option', { value: p.id, selected: p.id === provider.id }, p.label),
          ),
        ),
        h('span.field__hint', provider.blurb),
      ),

      isOffline ? null : h('label.field',
        h('span.field__label', 'API key', provider.requiresKey ? '' : ' (optional)'),
        h('input.input', {
          type: 'password',
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: provider.requiresKey ? 'Paste your free API key' : 'Usually blank for local servers',
          value: this.state.ai.apiKey,
          oninput: (e) => {
            this.state.ai.apiKey = e.target.value.trim();
            this.#persistAi();
          },
        }),
        provider.signupUrl
          ? h('span.field__hint',
              'Get one free at ',
              h('a', { href: provider.signupUrl, target: '_blank', rel: 'noreferrer noopener' },
                provider.signupUrl.replace(/^https?:\/\//, '')),
              '. It is stored in this browser only and sent straight to the provider.',
            )
          : null,
      ),

      isOffline ? null : h('label.field',
        h('span.field__label', 'Model'),
        provider.models.length
          ? h('input.input', {
              type: 'text',
              list: `models-${provider.id}`,
              value: this.state.ai.model || provider.defaultModel,
              oninput: (e) => { this.state.ai.model = e.target.value.trim(); this.#persistAi(); },
            })
          : h('input.input', {
              type: 'text',
              placeholder: 'Model name',
              value: this.state.ai.model,
              oninput: (e) => { this.state.ai.model = e.target.value.trim(); this.#persistAi(); },
            }),
        provider.models.length
          ? h('datalist', { id: `models-${provider.id}` },
              provider.models.map((m) => h('option', { value: m })))
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
            h('button.btn.btn--ghost', {
              onclick: (e) => this.#testConnection(e.currentTarget),
            }, 'Test connection'),
            this.state.testStatus
              ? h('span.status', { class: `status status--${this.state.testStatus.kind}` },
                  this.state.testStatus.message)
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
      const client = new AiClient({ ...this.state.ai, enabled: true });
      const reply = await client.test();
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
      h('button.btn.btn--primary.btn--block', {
        onclick: () => this.handlers.onStart({
          playerNationId: this.state.nationId,
          difficulty: this.state.difficulty,
          totalTurns: this.state.totalTurns,
          seed: this.state.seed.trim() || null,
          ai: this.state.ai,
        }),
      }, 'Take office'),
      hasSave()
        ? h('button.btn.btn--ghost.btn--block', { onclick: () => this.handlers.onContinue() },
            'Continue saved run')
        : null,
      h('label.btn.btn--ghost.btn--block.btn--file',
        'Load a save file',
        h('input', {
          type: 'file',
          accept: 'application/json,.json',
          onchange: (e) => {
            const file = e.target.files?.[0];
            if (file) this.handlers.onImport(file);
          },
        }),
      ),
    );
  }
}

function stat(label, value) {
  return h('div.microstat', h('span.microstat__label', label), h('span.microstat__value', String(value)));
}

