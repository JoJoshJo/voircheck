import { shownPaymentStatus } from '@voircheck/paypal/order-expiry';
import type { SignalId, SignalStatus } from '@voircheck/scanner';

/**
 * History risk log (AG Grid Community): one row per purchase attempt, plus one per link check that wasn't bought.
 * Pure mapping only, so the History grid can import it without pulling server code (or the scanner) into the browser.
 * Rows carry statuses and our own fields; no evidence text, page text or PayPal IDs.
 */

export type Verdict = 'SAFE' | 'HOLD' | 'BLOCK';
export type Outcome = 'paid' | 'paid_override' | 'held' | 'voided' | 'refund_pending' | 'refunded' | 'expired' | 'replaced' | 'waiting' | 'not_paid' | 'checked';
export const OUTCOMES: readonly Outcome[] = ['paid', 'paid_override', 'held', 'voided', 'refund_pending', 'refunded', 'expired', 'replaced', 'waiting', 'not_paid', 'checked'];

/** The six signals in display order (the scanner's own order; kept here so the browser bundle never imports it). */
export const SIGNAL_ORDER = ['domain_age', 'ssl_redirects', 'price', 'ai_page', 'threat_list', 'clone'] as const satisfies readonly SignalId[];

export interface RiskRow {
  id: string;
  kind: 'purchase' | 'check';
  /** ISO time; the grid shows it in the viewer's own zone. */
  at: string;
  ref: string | null;
  store: string;
  product: string;
  amount: number | null;
  currency: string;
  verdict: Verdict | null;
  score: number | null;
  signals: Partial<Record<SignalId, SignalStatus>>;
  outcome: Outcome;
  receiptSlug: string | null;
  scanId: string | null;
  paymentId: string | null;
}

/** What the loader reads for a payment (owned through its shopping session). */
export interface PaymentRecord {
  paymentId: string;
  sessionId: string;
  ref: string;
  status: string;
  overrideUsed: boolean;
  amount: string;
  currency: string;
  createdAt: Date;
  storeName: string;
  productTitle: string;
  scanId: string | null;
  verdict: string | null;
  riskScore: number | null;
  signals: unknown;
  receiptSlug: string | null;
}

/** A link check: the session, its candidate, and the latest scan of that URL. */
export interface LinkCheckRecord {
  sessionId: string;
  createdAt: Date;
  url: string;
  storeName: string | null;
  productTitle: string | null;
  price: string | null;
  currency: string | null;
  scanId: string | null;
  verdict: string | null;
  riskScore: number | null;
  signals: unknown;
}

/** Payment status → what the person sees. `expired` = never approved within PayPal's window: nothing charged. */
export function outcomeFor(p: { status: string; overrideUsed: boolean; createdAt: Date }, now: number = Date.now()): Outcome {
  switch (p.status) {
    case 'captured':
      return p.overrideUsed ? 'paid_override' : 'paid';
    case 'authorized':
      return 'held';
    case 'voided':
      return 'voided';
    case 'refund_pending':
      return 'refund_pending';
    case 'refunded':
      return 'refunded';
    case 'replaced':
      return 'replaced';
    case 'created':
      return shownPaymentStatus(p, now) === 'expired' ? 'expired' : 'waiting';
    case 'approved':
    case 'capture_pending':
      return 'waiting';
    default: // cancelled, capture_denied, failed
      return 'not_paid';
  }
}

const VERDICTS = new Set<string>(['SAFE', 'HOLD', 'BLOCK']);
const STATUSES = new Set<string>(['pass', 'warn', 'fail', 'unavailable']);
const verdictOf = (v: string | null): Verdict | null => (v && VERDICTS.has(v) ? (v as Verdict) : null);

/** Only each signal's id and status from the stored scan (never its evidence). Unknown shapes are dropped. */
export function signalStatuses(raw: unknown): RiskRow['signals'] {
  const out: RiskRow['signals'] = {};
  if (!Array.isArray(raw)) return out;
  for (const s of raw) {
    const { id, status } = (s ?? {}) as { id?: unknown; status?: unknown };
    if (typeof id === 'string' && (SIGNAL_ORDER as readonly string[]).includes(id) && typeof status === 'string' && STATUSES.has(status)) out[id as SignalId] = status as SignalStatus;
  }
  return out;
}

const money = (s: string | null): number | null => (s == null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export function toRiskRows(paymentRecords: readonly PaymentRecord[], linkChecks: readonly LinkCheckRecord[], now: number = Date.now()): RiskRow[] {
  const seen = new Set<string>();
  const rows: RiskRow[] = [];
  for (const p of paymentRecords) {
    if (seen.has(p.paymentId)) continue; // a payment joined to two receipts stays one row
    seen.add(p.paymentId);
    rows.push({
      id: `pay:${p.paymentId}`,
      kind: 'purchase',
      at: p.createdAt.toISOString(),
      ref: p.ref,
      store: p.storeName,
      product: p.productTitle,
      amount: money(p.amount),
      currency: p.currency,
      verdict: verdictOf(p.verdict),
      score: p.riskScore,
      signals: signalStatuses(p.signals),
      outcome: outcomeFor(p, now),
      receiptSlug: p.receiptSlug,
      scanId: p.scanId,
      paymentId: p.paymentId,
    });
  }
  // A link check someone went on to buy is already the purchase row.
  const bought = new Set(paymentRecords.map((p) => p.sessionId));
  for (const c of linkChecks) {
    if (bought.has(c.sessionId)) continue;
    rows.push({
      id: `check:${c.sessionId}`,
      kind: 'check',
      at: c.createdAt.toISOString(),
      ref: null,
      store: c.storeName ?? hostOf(c.url),
      product: c.productTitle ?? '',
      amount: money(c.price),
      currency: c.currency ?? 'USD',
      verdict: verdictOf(c.verdict),
      score: c.riskScore,
      signals: signalStatuses(c.signals),
      outcome: 'checked',
      receiptSlug: null,
      scanId: c.scanId,
      paymentId: null,
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 80);
  }
}

export interface RiskSummary {
  storesChecked: number;
  scamsBlocked: number;
  /** Sum of blocked (voided) payments' amounts, per currency: money that never reached the store. */
  protectedByCurrency: Record<string, number>;
  /** Sum of paid orders the person had refunded in full (completed refunds only), per currency. Kept apart from "protected". */
  refundedByCurrency: Record<string, number>;
}

function addTo(totals: Record<string, number>, r: RiskRow) {
  if (r.amount != null) totals[r.currency] = Math.round(((totals[r.currency] ?? 0) + r.amount) * 100) / 100;
}

export function summarize(rows: readonly RiskRow[]): RiskSummary {
  const protectedByCurrency: Record<string, number> = {};
  const refundedByCurrency: Record<string, number> = {};
  for (const r of rows) {
    if (r.outcome === 'voided') addTo(protectedByCurrency, r);
    if (r.outcome === 'refunded') addTo(refundedByCurrency, r);
  }
  return {
    storesChecked: rows.filter((r) => r.verdict).length,
    scamsBlocked: rows.filter((r) => r.verdict === 'BLOCK').length,
    protectedByCurrency,
    refundedByCurrency,
  };
}

export interface DayCount {
  day: string;
  SAFE: number;
  HOLD: number;
  BLOCK: number;
}

/** Verdicts per day, oldest first, for the stacked chart. `dayOf` turns an ISO time into the viewer's local day. */
export function verdictsPerDay(rows: readonly RiskRow[], dayOf: (iso: string) => string): DayCount[] {
  const days = new Map<string, DayCount>();
  for (const r of rows) {
    if (!r.verdict) continue;
    const day = dayOf(r.at);
    const d = days.get(day) ?? { day, SAFE: 0, HOLD: 0, BLOCK: 0 };
    d[r.verdict] += 1;
    days.set(day, d);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** The viewer's local calendar day (YYYY-MM-DD) for an ISO time. */
export function localDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(iso));
}

/** The History filters (verdict, outcome, local date range YYYY-MM-DD, both ends included). Shared by grid and list. */
export interface RiskFilters {
  verdict: Verdict | null;
  outcome: Outcome | null;
  from: string | null;
  to: string | null;
}

export function passesFilters(r: RiskRow, f: RiskFilters, dayOf: (iso: string) => string = (iso) => localDay(iso)): boolean {
  if (f.verdict && r.verdict !== f.verdict) return false;
  if (f.outcome && r.outcome !== f.outcome) return false;
  if (f.from || f.to) {
    const day = dayOf(r.at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
  }
  return true;
}
