// Themes. A theme is a `data-theme` value on <html>; every colour in the game —
// chrome, stat meters and the map's data encodings alike — resolves from CSS
// custom properties defined per theme in styles/main.css.
//
// `scheme` tells the data layer which validated palette set the theme renders
// against (light vs dark surfaces). Those two sets are the only data palettes
// that exist; themes vary the chrome around them.

export const THEMES = [
  {
    id: 'situation',
    name: 'Situation Room',
    scheme: 'dark',
    blurb: 'Deep navy command console. The default.',
    swatch: ['#0b1220', '#f0b429', '#3987e5'],
  },
  {
    id: 'graphite',
    name: 'Graphite',
    scheme: 'dark',
    blurb: 'Neutral dark grey. Quieter, less blue light.',
    swatch: ['#17181a', '#e2e8f0', '#3987e5'],
  },
  {
    id: 'daylight',
    name: 'Daylight',
    scheme: 'light',
    blurb: 'Light paper theme for bright rooms and projectors.',
    swatch: ['#f2f5fa', '#1c5cab', '#d95926'],
  },
  {
    id: 'contrast',
    name: 'High Contrast',
    scheme: 'dark',
    blurb: 'Pure black, maximum contrast, heavier outlines.',
    swatch: ['#000000', '#ffffff', '#ffd400'],
  },
  {
    id: 'terminal',
    name: 'Amber Terminal',
    scheme: 'dark',
    blurb: 'Monochrome CRT with amber phosphor.',
    swatch: ['#0a0c08', '#ffb000', '#7ad07a'],
  },
];

export const THEMES_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
export const DEFAULT_THEME = 'situation';

/** Text-size presets, applied as a root font-size multiplier. */
export const UI_SCALES = [
  { id: 'compact', name: 'Compact', factor: 0.92 },
  { id: 'normal', name: 'Normal', factor: 1 },
  { id: 'large', name: 'Large', factor: 1.1 },
  { id: 'xlarge', name: 'Extra large', factor: 1.22 },
];

export const UI_SCALES_BY_ID = Object.fromEntries(UI_SCALES.map((s) => [s.id, s]));
export const DEFAULT_UI_SCALE = 'normal';

export function applyTheme(themeId) {
  const theme = THEMES_BY_ID[themeId] || THEMES_BY_ID[DEFAULT_THEME];
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.scheme;
  root.style.colorScheme = theme.scheme;
  return theme;
}

export function applyUiScale(scaleId) {
  const scale = UI_SCALES_BY_ID[scaleId] || UI_SCALES_BY_ID[DEFAULT_UI_SCALE];
  document.documentElement.style.setProperty('--ui-scale', String(scale.factor));
  return scale;
}
