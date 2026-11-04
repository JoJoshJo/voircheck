import { GHOST_STROKES } from '../components/Mascot';
import { SIGNAL_ORDER, type SignalState } from '../components/SignalIcon';

/** Ghost strokes earned so far: one per finished check (any result counts; still-running ones don't). */
export function builtStrokes(signals: Partial<Record<string, SignalState>>): number {
  const done = SIGNAL_ORDER.filter((id) => (signals[id] ?? 'pending') !== 'pending').length;
  return Math.min(GHOST_STROKES, done);
}
