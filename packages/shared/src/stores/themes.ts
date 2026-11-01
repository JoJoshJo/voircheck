import type { Theme } from './types';

// Palettes picked by J on Nov 1 (Velbrook "Glacier blue", Ondaya "Sage", Nyuie "Green & gold"); all pass WCAG AA.
const velbrook: Theme = {
  layout: 'classic',
  colors: { bg: '#EEF3F6', surface: '#FFFFFF', ink: '#10222E', muted: '#52666F', accent: '#0F5E86', accentInk: '#FFFFFF', border: '#D5E0E6' },
  headingFont: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  bodyFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  radius: '4px',
};

const ondaya: Theme = {
  layout: 'split',
  colors: { bg: '#F3F5F0', surface: '#FFFFFF', ink: '#1F2A24', muted: '#5F6C63', accent: '#4E6E57', accentInk: '#FFFFFF', border: '#DFE5DC' },
  headingFont: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif',
  bodyFont: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif',
  radius: '18px',
};

const nyuie: Theme = {
  layout: 'bold',
  colors: { bg: '#FFFCF5', surface: '#FFF6DE', ink: '#1D1A10', muted: '#655E4A', accent: '#0E6B3F', accentInk: '#FFD23F', border: '#F0E6C8' },
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
