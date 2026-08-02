// The new-game screen: how to play, which world, which country, how hard, how
// it looks, and (optionally) which free AI provider.

import { REGIONS, playableNations, powerRank } from '../data/nations.js';
import {
  ARCHETYPES,
  byDifficulty,
  createCountry,
  recommendedStarts,
  startDifficulty,
  validateCountry,
} from '../engine/starts.js';
import { DIFFICULTY_MAX, DIFFICULTY_MIN, difficultyModifiers, difficultyPreview } from '../engine/difficulty.js';
import { WORLD_MODES, modePreview } from '../engine/worldmodes.js';
import { PROVIDERS, PROVIDERS_BY_ID } from '../ai/providers.js';
import { AiClient } from '../ai/client.js';
import { h, mount } from './dom.js';
import { THEMES, UI_SCALES, applyTheme, applyUiScale } from './theme.js';
import { hasSave, loadAiConfig, loadPrefs, saveAiConfig, savePrefs } from './store.js';
import { LANGUAGES, currentLanguage, setLanguage, t, tIn, tLabel, tNation } from '../i18n/index.js';

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
      language: prefs.language,
      seed: '',
      search: '',
      region: 'all',
      // Easiest-first is the default order, because the commonest first move is
      // "which of these should I actually pick".
      order: 'ease',
      // The build-your-own panel, and the country it is describing.
      ownOpen: false,
      own: { name: '', capital: '', flag: '🏳️', region: 'western-europe', archetype: 'trading-port' },
      ai: loadAiConfig(),
      testStatus: null,
      // Which sidebar folds are open. Kept here because choosing a theme
      // re-renders the screen, and a fold that snapped shut every time you
      // picked one would be unusable.
      openFolds: new Set(),
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
            h('h2.panel__title', t('setup.chooseCountry', 'Choose your country')),
            this.#suggestedStarts(),
            this.#countryFilters(),
            this.#countryGrid(),
            this.#ownCountry(),
          ),
          h('div.setup__side',
            // Difficulty first: it is the one control every player touches, and
            // it must not be hidden below three world cards.
            this.#difficultyPanel(),
            this.#worldModePanel(),
            // Everything below is set once and forgotten, so it starts folded
            // and the sidebar stops running half a page past the country list.
            this.#fold('appearance', t('setup.appearance', 'Appearance'), this.#appearancePanel()),
            this.#fold('rules', t('setup.runSettings', 'Run settings'), this.#rulesPanel()),
            this.#fold('ai', t('settings.aiOptional', 'AI narrator (optional)'), this.#aiPanel(), this.#aiSummary()),
            this.#startPanel(),
          ),
        ),
      ),
    );
  }

  #hero() {
    return h('header.hero',
      h('div.hero__mark', 'PAX'),
      h('div.hero__body',
        h('h1.hero__title', 'Pax Sophistc'),
        h('p.hero__sub', t('app.tagline',
          'Run any country on earth from 2026 onward. Choose the world you want to play in, set how hard it pushes back, and see how far you get. Runs entirely in your browser; free AI narration optional.')),
      ),
      // The language switch lives in the header rather than three panels down:
      // it is the first thing a player who does not read English needs.
      this.#languageSwitch(),
    );
  }

  /** Two chips, always visible, that change the whole interface language. */
  #languageSwitch() {
    return h('div.langswitch', { role: 'group', 'aria-label': t('setup.language', 'Language') },
      LANGUAGES.map((lang) =>
        h('button.langswitch__btn', {
          class: currentLanguage() === lang.id ? 'langswitch__btn is-active' : 'langswitch__btn',
          'aria-pressed': String(currentLanguage() === lang.id),
          onclick: () => this.#setLanguage(lang.id),
        }, lang.native),
      ),
    );
  }

  #setLanguage(id) {
    setLanguage(id);
    savePrefs({ language: id });
    this.state.language = id;
    this.render();
  }

  #quickstart() {
    return h('section.panel', { style: { marginBottom: '1.25rem' } },
      h('h2.panel__title', t('setup.howItWorks', 'How it works')),
      h('div.quickstart',
        [
          ['setup.step1', '<b>Pick a country.</b> Anything from the United States to Cuba. Each one starts from its real 2026 position.'],
          ['setup.step2', '<b>Issue up to four orders</b> each quarter — spend money and political capital on the economy, the army, diplomacy or your own population.'],
          ['setup.step3', '<b>The world answers.</b> Fifty-five other governments move, crises land on your desk, and you get a briefing on what changed.'],
          ['setup.step4', '<b>Get graded.</b> At the end of your term you are scored against the mandate you were handed on day one.'],
        ].map(([key, fallback], i) =>
          h('div.quickstart__step',
            h('div.quickstart__num', String(i + 1)),
            h('div.quickstart__text', { html: t(key, fallback) }),
          ),
        ),
      ),
    );
  }

  #worldModePanel() {
    return h('section.panel',
      h('h2.panel__title', t('setup.world', 'World')),
      h('div.mode-cards',
        WORLD_MODES.map((mode) =>
          h('button.mode-card', {
            class: this.state.worldMode === mode.id ? 'mode-card is-active' : 'mode-card',
            onclick: () => { this.state.worldMode = mode.id; this.render(); },
            'aria-pressed': String(this.state.worldMode === mode.id),
          },
            h('div.mode-card__head',
              h('span.mode-card__icon', mode.icon),
              h('span.mode-card__name', tLabel('modes', mode.id, mode.name)),
            ),
            h('div.mode-card__blurb', tIn('modes', mode.id, 'blurb', mode.blurb)),
            this.state.worldMode === mode.id
              ? h('div',
                  h('div.mode-card__traits',
                    (tIn('modes', mode.id, 'traits', null) || mode.traits).map((trait) => h('span.badge', trait))),
                  h('ul.difficulty__list', { style: { marginTop: '0.5rem' } },
                    modePreview(mode.id).map((line) => h('li', line))),
                )
              : null,
          ),
        ),
      ),
    );
  }

  /**
   * The six gentlest countries on the board, as buttons.
   *
   * The commonest first move is picking the United States because it is at the
   * top of the list, and the United States is one of the harder runs — fifty
   * relationships and a world that reacts to everything. This says so.
   */
  #suggestedStarts() {
    const picks = recommendedStarts(6);
    return h('div.suggested',
      h('div.suggested__label', t('setup.goodFirst', 'Good for a first run')),
      h('div.suggested__row',
        picks.map(({ nation, band }) =>
          h('button.suggested__pick', {
            class: this.state.nationId === nation.id ? 'suggested__pick is-active' : 'suggested__pick',
            title: t(`start.${band.id}Hint`, band.hint),
            onclick: () => { this.state.nationId = nation.id; this.render(); },
          },
            h('span.suggested__flag', nation.flag),
            h('span.suggested__name', tNation(nation)),
          ),
        ),
      ),
    );
  }

  /**
   * A country that does not exist.
   *
   * Not a points-buy screen — a name, a place and one of six shapes a player
   * can actually picture. Everything else is derived, and the result is
   * registered so the rest of the engine cannot tell it from one that shipped.
   */
  #ownCountry() {
    const own = this.state.own;
    const check = validateCountry(own);
    const archetype = ARCHETYPES.find((a) => a.id === own.archetype) || ARCHETYPES[0];

    return h('details.panel.panel--fold.panel--own', {
      open: this.state.ownOpen,
      ontoggle: (e) => { this.state.ownOpen = e.currentTarget.open; },
    },
      h('summary.panel__fold',
        h('span.panel__title', t('own.title', 'Or invent one')),
        h('span.panel__foldValue', own.name || t('own.none', 'not yet')),
      ),
      h('div.panel__foldBody',
        h('p.panel__note',
          t('own.body',
            'A country of your own, dropped into a world of fifty-six that will treat it exactly like the rest.')),

        h('div.own__row',
          h('label.field',
            h('span.field__label', t('own.name', 'Name')),
            h('input.input', {
              type: 'text', value: own.name, maxlength: 34,
              placeholder: t('own.namePlaceholder', 'The Republic of ——'),
              oninput: (e) => { own.name = e.target.value; this.#refreshOwn(); },
            }),
          ),
          h('label.field.field--narrow',
            h('span.field__label', t('own.flag', 'Flag')),
            h('input.input', {
              type: 'text', value: own.flag, maxlength: 4,
              oninput: (e) => { own.flag = e.target.value; this.#refreshOwn(); },
            }),
          ),
        ),
        h('div.own__row',
          h('label.field',
            h('span.field__label', t('own.capital', 'Capital')),
            h('input.input', {
              type: 'text', value: own.capital, maxlength: 26,
              placeholder: t('own.capitalPlaceholder', 'leave blank and one will be named for you'),
              oninput: (e) => { own.capital = e.target.value; },
            }),
          ),
          h('label.field',
            h('span.field__label', t('own.where', 'Where')),
            h('select.input', {
              onchange: (e) => { own.region = e.target.value; this.#refreshOwn(); },
            },
              REGIONS.map((r) =>
                h('option', { value: r.id, selected: own.region === r.id }, tLabel('regions', r.id, r.name))),
            ),
          ),
        ),

        h('span.field__label', t('own.shape', 'What kind of country')),
        h('div.own__shapes',
          ARCHETYPES.map((a) =>
            h('button.own__shape', {
              class: own.archetype === a.id ? 'own__shape is-active' : 'own__shape',
              onclick: () => { own.archetype = a.id; this.render(); },
            },
              h('div.own__shapeName', t(`archetype.${a.id}`, a.name)),
              h('div.own__shapeBlurb', t(`archetype.${a.id}Blurb`, a.blurb)),
              h('div.own__shapeStats',
                `$${a.stats.gdp}T · ${a.stats.population}M · ${t('stat.military', 'Mil')} ${a.stats.military} · ${t('stat.stability', 'Stab')} ${a.stats.stability}`),
              h('div.own__shapeEase', { class: `own__shapeEase is-${a.difficulty}` },
                t(`start.${a.difficulty}`, a.difficulty)),
            ),
          ),
        ),

        // Always rendered, disabled until the spec is usable — otherwise typing a
        // name has nothing to enable, because the button does not exist yet.
        h('button.btn.btn--primary.btn--block', {
          disabled: !check.ok,
          onclick: () => {
            const spec = { ...this.state.own };
            if (!validateCountry(spec).ok) return;
            const def = createCountry(spec);
            this.state.nationId = def.id;
            this.state.ownOpen = false;
            this.render();
          },
        }, check.ok
          ? t('own.create', 'Found {name} and play as it', { name: own.name })
          : check.problems[0]),
      ),
    );
  }

  /** Only the create button and the summary depend on the text fields. */
  #refreshOwn() {
    const summary = this.root.querySelector('.panel--own .panel__foldValue');
    if (summary) summary.textContent = this.state.own.name || t('own.none', 'not yet');
    const button = this.root.querySelector('.panel--own .btn--primary');
    const check = validateCountry(this.state.own);
    if (button) {
      button.disabled = !check.ok;
      button.textContent = check.ok
        ? t('own.create', 'Found {name} and play as it', { name: this.state.own.name })
        : check.problems[0];
    }
  }

  #countryFilters() {
    return h('div.filters',
      h('input.input.filters__search', {
        type: 'search',
        placeholder: t('setup.search', 'Search 56 countries…'),
        value: this.state.search,
        oninput: (e) => { this.state.search = e.target.value; this.#refreshGrid(); },
      }),
      h('div.chips.chips--tight',
        h('span.filters__sortLabel', t('setup.order', 'Order')),
        [
          ['ease', t('setup.orderEase', 'Easiest first')],
          ['power', t('setup.orderPower', 'Most powerful first')],
          ['name', t('setup.orderName', 'A–Z')],
        ].map(([id, label]) =>
          h('button.chip.chip--sm', {
            class: this.state.order === id ? 'chip chip--sm is-active' : 'chip chip--sm',
            onclick: () => { this.state.order = id; this.#refreshGrid(); },
          }, label),
        ),
      ),
      h('div.chips',
        h('button.chip', {
          class: this.state.region === 'all' ? 'chip is-active' : 'chip',
          onclick: () => { this.state.region = 'all'; this.render(); },
        }, t('setup.allRegions', 'All regions')),
        REGIONS.map((r) =>
          h('button.chip', {
            class: this.state.region === r.id ? 'chip is-active' : 'chip',
            onclick: () => { this.state.region = r.id; this.render(); },
          }, tLabel('regions', r.id, r.name)),
        ),
      ),
    );
  }

  #visibleNations() {
    const q = this.state.search.trim().toLowerCase();
    const matched = playableNations().filter((n) => {
      if (this.state.region !== 'all' && n.region !== this.state.region) return false;
      if (!q) return true;
      return (
        n.name.toLowerCase().includes(q) ||
        n.adjective.toLowerCase().includes(q) ||
        // Search the translated name too, so Korean players can type Korean.
        tNation(n).toLowerCase().includes(q) ||
        n.id.includes(q) ||
        n.tags.some((tag) => tag.includes(q))
      );
    });

    if (this.state.order === 'name') return matched.sort((a, b) => tNation(a).localeCompare(tNation(b)));
    if (this.state.order === 'power') return matched.sort((a, b) => powerRank(b) - powerRank(a));
    return matched.sort(byDifficulty);
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
      : h('p.empty', t('setup.noMatch', 'No country matches that search.')));
  }

  #countryCard(nation) {
    const selected = nation.id === this.state.nationId;
    const tier = powerRank(nation);
    const label =
      tier >= 155 ? t('tier.superpower', 'Superpower')
      : tier >= 120 ? t('tier.great', 'Great power')
      : tier >= 100 ? t('tier.major', 'Major power')
      : tier >= 84 ? t('tier.regional', 'Regional power')
      : tier >= 74 ? t('tier.middle', 'Middle power')
      : t('tier.small', 'Small power');

    const start = startDifficulty(nation);

    return h('button.country', {
      class: selected ? 'country is-selected' : 'country',
      onclick: () => { this.state.nationId = nation.id; this.render(); },
      'aria-pressed': String(selected),
    },
      h('div.country__head',
        h('span.country__flag', nation.flag),
        h('div',
          h('div.country__name', tNation(nation)),
          h('div.country__tier', `${label} · ${tNation(nation, 'government')}`),
        ),
      ),
      h('p.country__brief', tNation(nation, 'brief')),
      h('div.country__why',
        start.reasons.slice(0, 3).map((r) => h('span.country__reason', r.text))),
      h('div.country__stats',
        h('span.country__ease', {
          class: `country__ease is-${start.band.id}`,
          title: `${t(`start.${start.band.id}Hint`, start.band.hint)} — ${start.reasons.map((r) => r.text).join(', ')}`,
        }, t(`start.${start.band.id}`, start.band.label)),
        stat(t('stat.gdp', 'GDP'), `$${nation.gdp.toFixed(2)}T`),
        stat(t('stat.population', 'Pop'), `${nation.population}M`),
        stat(t('stat.military', 'Mil'), nation.military),
        stat(t('stat.stability', 'Stab'), nation.stability),
        nation.nukes > 0 ? stat(t('stat.nukes', 'Nukes'), nation.nukes) : null,
      ),
    );
  }

  #difficultyPanel() {
    const mods = difficultyModifiers(this.state.difficulty);
    return h('section.panel',
      h('h2.panel__title', t('setup.difficulty', 'Difficulty')),
      h('div.difficulty',
        h('div.difficulty__head',
          h('span.difficulty__tier', tLabel('tiers', mods.tier.name, mods.tier.name)),
          h('span.difficulty__value', `${this.state.difficulty} / ${DIFFICULTY_MAX}`),
        ),
        h('input.slider', {
          type: 'range',
          min: DIFFICULTY_MIN, max: DIFFICULTY_MAX, step: 1,
          value: this.state.difficulty,
          'aria-label': 'Difficulty',
          oninput: (e) => { this.state.difficulty = Number(e.target.value); this.render(); },
        }),
        h('div.slider__scale',
          h('span', t('setup.scaleLow', 'Détente')),
          h('span', t('setup.scaleMid', 'Contested')),
          h('span', t('setup.scaleHigh', 'Doomsday')),
        ),
        h('p.difficulty__blurb', tIn('tiers', mods.tier.name, 'blurb', mods.tier.blurb)),
        h('ul.difficulty__list', difficultyPreview(this.state.difficulty).map((line) => h('li', line))),
      ),
    );
  }

  #appearancePanel() {
    return h('div',
      h('div.theme-grid',
        THEMES.map((theme) =>
          h('button.theme-card', {
            class: this.state.theme === theme.id ? 'theme-card is-active' : 'theme-card',
            title: tIn('themes', theme.id, 'blurb', theme.blurb),
            onclick: () => {
              this.state.theme = theme.id;
              applyTheme(theme.id);
              savePrefs({ theme: theme.id });
              this.render();
            },
          },
            h('div.theme-card__swatches',
              theme.swatch.map((colour) => h('span.theme-card__swatch', { style: { background: colour } }))),
            h('div.theme-card__name', tLabel('themes', theme.id, theme.name)),
          ),
        ),
      ),
      h('label.field', { style: { marginTop: '0.75rem' } },
        h('span.field__label', t('setup.language', 'Language')),
        h('div.chips',
          LANGUAGES.map((lang) =>
            h('button.chip', {
              class: currentLanguage() === lang.id ? 'chip is-active' : 'chip',
              onclick: () => {
                setLanguage(lang.id);
                savePrefs({ language: lang.id });
                this.state.language = lang.id;
                this.render();
              },
            }, lang.native),
          ),
        ),
      ),
      h('label.field', { style: { marginBottom: 0 } },
        h('span.field__label', t('setup.textSize', 'Text size')),
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
            }, tLabel('scales', scale.id, scale.name)),
          ),
        ),
      ),
    );
  }

  #rulesPanel() {
    return h('div',
      h('label.field',
        h('span.field__label', t('setup.termLength', 'Length of term')),
        h('select.input', { onchange: (e) => { this.state.totalTurns = Number(e.target.value); } },
          [[16, t('setup.term16', '4 years (16 quarters)')],
           [40, t('setup.term40', '10 years (40 quarters)')],
           [80, t('setup.term80', '20 years (80 quarters)')]].map(
            ([value, label]) => h('option', { value, selected: this.state.totalTurns === value }, label)),
        ),
      ),
      h('label.field',
        h('span.field__label', t('setup.seed', 'Seed (optional)')),
        h('input.input', {
          type: 'text',
          placeholder: t('setup.seedPlaceholder', 'Leave blank for random'),
          value: this.state.seed,
          oninput: (e) => { this.state.seed = e.target.value; },
        }),
        h('span.field__hint', t('setup.seedHint', 'The same seed and the same orders replay the same world.')),
      ),
    );
  }

  #aiPanel() {
    const provider = PROVIDERS_BY_ID[this.state.ai.providerId] || PROVIDERS[0];
    const isOffline = provider.kind === 'none';

    return h('div',
      h('p.panel__note', t('settings.aiNotice',
        'The game is fully playable without this. A language model writes the briefings, judges freeform orders and answers your advisers. Every option below has a free tier.')),
      h('label.field',
        h('span.field__label', t('settings.provider', 'Provider')),
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
        h('span.field__label', provider.requiresKey ? t('settings.apiKey', 'API key') : t('settings.apiKeyOptional', 'API key (optional)')),
        h('input.input', {
          type: 'password', autocomplete: 'off', spellcheck: 'false',
          placeholder: provider.requiresKey ? 'Paste your free API key' : 'Usually blank for local servers',
          value: this.state.ai.apiKey,
          oninput: (e) => { this.state.ai.apiKey = e.target.value.trim(); this.#persistAi(); },
        }),
        provider.signupUrl
          ? h('span.field__hint', t('settings.getFreeKey', 'Get one free at '),
              h('a', { href: provider.signupUrl, target: '_blank', rel: 'noreferrer noopener' },
                provider.signupUrl.replace(/^https?:\/\//, '')),
              t('settings.keyStorage', '. It is stored in this browser only and sent straight to the provider.'))
          : null,
      ),

      isOffline ? null : h('label.field',
        h('span.field__label', t('settings.model', 'Model')),
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
            h('span.field__label', t('settings.endpoint', 'Endpoint URL')),
            h('input.input', {
              type: 'url',
              placeholder: 'http://localhost:8080/v1/chat/completions',
              value: this.state.ai.endpoint,
              oninput: (e) => { this.state.ai.endpoint = e.target.value.trim(); this.#persistAi(); },
            }),
          )
        : null,

      isOffline
        ? h('p.panel__note.panel__note--ok', t('settings.offlineOk',
            'Offline mode works: briefings are written by a local generator instead. You can add a key later from Settings.'))
        : h('div.row',
            h('button.btn.btn--ghost', { onclick: (e) => this.#testConnection(e.currentTarget) }, t('settings.test', 'Test connection')),
            this.state.testStatus
              ? h('span.status', { class: `status status--${this.state.testStatus.kind}` }, this.state.testStatus.message)
              : null,
          ),
    );
  }

  /**
   * A panel that folds. Native <details>, so keyboard and screen-reader
   * behaviour come for free; the open/closed state is remembered here so a
   * re-render does not slam it shut mid-choice.
   */
  #fold(id, title, body, summary = null) {
    return h('details.panel.panel--fold', {
      open: this.state.openFolds.has(id),
      ontoggle: (e) => {
        if (e.currentTarget.open) this.state.openFolds.add(id);
        else this.state.openFolds.delete(id);
      },
    },
      h('summary.panel__fold',
        h('span.panel__title', title),
        summary ? h('span.panel__foldValue', summary) : null,
      ),
      h('div.panel__foldBody', body),
    );
  }

  /** What the AI fold says while it is closed. */
  #aiSummary() {
    const provider = PROVIDERS_BY_ID[this.state.ai.providerId] || PROVIDERS[0];
    return provider.kind === 'none'
      ? t('setup.aiOff', 'Off — briefings written locally')
      : provider.label;
  }

  async #testConnection(button) {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = t('settings.testing', 'Testing…');
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
      }, t('setup.takeOffice', 'Take office')),
      hasSave()
        ? h('button.btn.btn--ghost.btn--block', { onclick: () => this.handlers.onContinue() }, t('setup.continue', 'Continue saved run'))
        : null,
      h('label.btn.btn--ghost.btn--block.btn--file',
        t('setup.loadFile', 'Load a save file'),
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

function stat(label, value) {
  return h('div.microstat', h('span.microstat__label', label), h('span.microstat__value', String(value)));
}
