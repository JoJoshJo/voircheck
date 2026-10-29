import { DICTS, fmt, type Lang } from './i18n';
import type { ReceiptSnapshot } from './receipt-snapshot';

/**
 * Trust Receipt email (spec 5.3 #6): Mono ink (white, #0C0C0C), the verdict pill is the only color.
 * Plain inline HTML + a plain-text version. Contains only what the public receipt page shows (no PayPal IDs,
 * no personal info). Every dynamic string is HTML-escaped: evidence can quote text from scanned store pages.
 */

const VERDICT_COLORS = {
  SAFE: { bg: '#EAF3DE', fg: '#27500A' },
  HOLD: { bg: '#FAEEDA', fg: '#633806' },
  BLOCK: { bg: '#FCEBEB', fg: '#791F1F' },
} as const;

/** Outcomes that get an email: the money decision is final. A HOLD gets its email when the user captures or voids. */
export const EMAIL_ACTIONS = ['captured', 'override', 'voided'] as const;
export const isFinalAction = (a: ReceiptSnapshot['action']) => (EMAIL_ACTIONS as readonly string[]).includes(a);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Top reasons: red flags first, then warnings (most points first); if none, the passing checks. */
export function topReasons(s: ReceiptSnapshot, max = 3): Array<{ id: string; summary: string }> {
  const rank: Record<string, number> = { fail: 0, warn: 1, pass: 2 };
  return s.signals
    .filter((x) => x.summary && x.status in rank)
    .sort((a, b) => rank[a.status]! - rank[b.status]! || b.points - a.points)
    .slice(0, max)
    .map((x) => ({ id: x.id, summary: x.summary }));
}

export interface ReceiptEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildReceiptEmail(input: { snapshot: ReceiptSnapshot; slug: string; lang: Lang; baseUrl: string }): ReceiptEmail {
  const { snapshot: s, lang } = input;
  const t = DICTS[lang];
  const url = `${input.baseUrl.replace(/\/$/, '')}/r/${encodeURIComponent(input.slug)}`;
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const money = s.amount ? new Intl.NumberFormat(locale, { style: 'currency', currency: s.currency }).format(Number(s.amount)) : '';
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(s.actionAt));
  const outcome = t.receipt[`action_${s.action}`];
  const verdict = t.verdict[s.verdict];
  const labels = t.signals as Record<string, string>;
  const reasons = topReasons(s).map((r) => ({ label: labels[r.id] ?? r.id, summary: r.summary }));
  const e = t.email;
  const subject = fmt(e.subject, { store: s.storeName, outcome });
  const c = VERDICT_COLORS[s.verdict];

  // French typography: a (non-breaking) space before the colon.
  const k = (label: string) => (lang === 'fr' ? `${label}\u00a0:` : `${label}:`);
  const text = [
    `${e.heading}`,
    '',
    `${k(e.store)} ${s.storeName} (${s.storeUrl ?? s.storeHost})`,
    `${k(e.product)} ${s.productTitle}`,
    money ? `${k(e.amount)} ${money}` : null,
    `${k(e.verdict)} ${verdict} · ${t.workspace.score} ${s.score}/100`,
    `${k(e.outcome)} ${outcome}`,
    '',
    k(e.reasons),
    ...reasons.map((r) => `- ${k(r.label)} ${r.summary}`),
    '',
    `${k(e.view)} ${url}`,
    '',
    fmt(t.receipt.when, { when: `${when} UTC` }),
    e.footer,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 0;color:#6B6866;font-size:13px;width:110px;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:15px;color:#0C0C0C">${escapeHtml(v)}</td></tr>`;
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;color:#0C0C0C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,Inter,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="font-size:15px;font-weight:500;padding-bottom:24px">VoirCheck</td></tr>
<tr><td style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#A8A29E;padding-bottom:8px">${escapeHtml(e.heading)}</td></tr>
<tr><td style="padding-bottom:4px"><span style="display:inline-block;background:${c.bg};color:${c.fg};border-radius:999px;padding:4px 12px;font-size:13px;font-weight:500">${escapeHtml(verdict)} · ${s.score}/100</span></td></tr>
<tr><td style="font-size:24px;font-weight:500;padding:12px 0 4px">${escapeHtml(s.storeName)}</td></tr>
<tr><td style="font-size:15px;color:#0C0C0C;padding-bottom:20px">${escapeHtml(outcome)}</td></tr>
<tr><td style="border-top:1px solid #E7E5E4;border-bottom:1px solid #E7E5E4;padding:12px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row(e.product, s.productTitle)}${money ? row(e.amount, money) : ''}${row(e.store, s.storeUrl ?? s.storeHost)}
</table></td></tr>
<tr><td style="font-size:13px;font-weight:500;padding:20px 0 8px">${escapeHtml(e.reasons)}</td></tr>
${reasons
  .map(
    (r) =>
      `<tr><td style="padding:0 0 10px;font-size:14px;line-height:1.5"><span style="font-weight:500">${escapeHtml(r.label)}</span><br><span style="color:#6B6866">${escapeHtml(r.summary)}</span></td></tr>`,
  )
  .join('\n')}
<tr><td style="padding:16px 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0C0C0C;color:#FFFFFF;text-decoration:none;border-radius:999px;padding:12px 22px;font-size:15px;font-weight:500">${escapeHtml(e.view)}</a></td></tr>
<tr><td style="font-size:12px;color:#A8A29E;line-height:1.5">${escapeHtml(fmt(t.receipt.when, { when: `${when} UTC` }))}<br>${escapeHtml(e.footer)}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text };
}
