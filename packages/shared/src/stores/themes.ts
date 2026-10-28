import type { Theme } from './types';

const velbrook: Theme = {
  layout: 'classic',
  colors: { bg: '#F7F3EA', surface: '#FFFDF8', ink: '#1C2620', muted: '#5E6B62', accent: '#1F4D35', accentInk: '#FFFFFF', border: '#E3DCCB' },
  headingFont: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  bodyFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  radius: '4px',
};

const ondaya: Theme = {
  layout: 'split',
  colors: { bg: '#FBF7F4', surface: '#FFFFFF', ink: '#2B1E19', muted: '#7A675E', accent: '#B4532A', accentInk: '#FFFFFF', border: '#EFE3DB' },
  headingFont: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif',
  bodyFont: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif',
  radius: '18px',
};

const nyuie: Theme = {
  layout: 'bold',
  colors: { bg: '#FFFFFF', surface: '#F4F3FF', ink: '#16153A', muted: '#55537A', accent: '#2D2A8C', accentInk: '#FFD45C', border: '#E2E0F5' },
  headingFont: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  bodyFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  radius: '10px',
};

/** Keys match demo_stores.theme in the db seed. Clones reuse their twin's theme exactly. */
export const STORE_THEMES: Record<string, Theme> = {
  'velbrook-supply': velbrook,
  'velbrook-outlet-deals': velbrook,
  'ondaya-home': ondaya,
  '0ndaya-home': ondaya,
  'nyuie-market': nyuie,
  'nyuie-market-clearance': nyuie,
};
