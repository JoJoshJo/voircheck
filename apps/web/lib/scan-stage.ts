import type { Dict } from './i18n';

/**
 * A friendly line for a store check in progress, from how many of the six checks have reported so far (the scanner
 * streams them as they finish): "Looking at the shop…", "Reading its pages…", "Checking the price…", "Almost done…".
 */
export function scanStage(t: Dict, signals: Partial<Record<string, string>>): string {
  const done = Object.values(signals).filter((s) => s && s !== 'pending').length;
  const s = t.stage;
  return done === 0 ? s.visiting : done <= 2 ? s.reading : done <= 4 ? s.price : s.almost;
}
