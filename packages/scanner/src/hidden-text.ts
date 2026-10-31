import { z } from 'zod';

/**
 * Hidden-text extract (spec 5.13 injection showcase, prepares the AI signal). Text that is in the DOM but hidden from
 * people (clipped to 1px, offscreen, opacity 0, display:none, tiny font, same colour as its background, long
 * aria-hidden blocks) is where scam pages plant instructions aimed at AI shopping agents.
 *
 * The browser side only reports raw candidates; the filtering (normal UI patterns) and the injection flag run here,
 * so they are unit-tested. Hidden text is UNTRUSTED data: it's quoted as evidence, never acted on. Evidence only:
 * it doesn't change scores yet.
 */

export const HIDDEN_REASONS = ['clipped', 'offscreen', 'opacity_0', 'visibility_hidden', 'display_none', 'tiny_font', 'same_color', 'zero_size', 'aria_hidden'] as const;
export type HiddenReason = (typeof HIDDEN_REASONS)[number];

/** What the browser reports for each hidden element (outermost hidden element only; its descendants are not repeated). */
export const HiddenCandidate = z.object({
  text: z.string().max(1000),
  reason: z.enum(HIDDEN_REASONS),
  /** Selector-ish hint, e.g. `div[data-planted].sr-only`. */
  hint: z.string().max(120),
  /** Share of the text that sits inside links (menus are mostly links). */
  linkRatio: z.number().min(0).max(1),
  /** Element/ancestor markers used by the UI-pattern filter: tag, role, ids/classes of the element and up to 3 ancestors. */
  context: z.string().max(400),
  /** An in-page link like "#main" (skip links). */
  hashLink: z.boolean(),
});
export type HiddenCandidate = z.infer<typeof HiddenCandidate>;

export const HiddenText = z.object({
  text: z.string().max(1000),
  reason: z.enum(HIDDEN_REASONS),
  hint: z.string().max(120),
  /** Hidden text that addresses AI agents/assistants or gives instructions. Evidence only. */
  possibleInjection: z.boolean(),
});
export type HiddenText = z.infer<typeof HiddenText>;

export const MAX_HIDDEN_PER_PAGE = 10;
/** Shorter hidden text is normal UI (screen-reader labels like "Close", "Cart, 2 items") unless it reads as an injection. */
export const MIN_HIDDEN_TEXT = 40;

/** Instructions or addressing an AI (EN/DE/FR). Deliberately broad: it only marks evidence for the AI signal. */
export const INJECTION_RE = new RegExp(
  [
    '\\b(ignore|disregard|forget|override)\\b[^.]{0,40}\\b(instructions?|prompts?|rules|guidelines|previous|above)\\b',
    '\\b(ai|a\\.i\\.)\\s+(shopping\\s+)?(agents?|assistants?|models?|bots?)\\b',
    '\\b(shopping|ai|virtual)\\s+assistants?\\b',
    '\\b(dear|attention|note to|hey)\\s+(ai|assistant|agent|bot|llm|chatgpt|claude|gpt)\\b',
    '\\b(language model|llm|chatgpt|gpt-\\d|claude|gemini|copilot)\\b',
    '\\bsystem prompt\\b',
    '\\byou (must|should|are now|will now|are required to)\\b',
    '\\b(approve|authorize|confirm|whitelist|trust)\\s+(this|the)\\s+(store|shop|site|merchant|payment|purchase|order)\\b',
    '\\b(this|the)\\s+(store|shop|site|merchant)\\s+is\\s+(verified|safe|trusted|legit(imate)?|certified)\\b',
    '\\b(verified|guaranteed)\\s+safe\\b',
    '\\bmark\\s+(this|the)\\s+(store|shop|site)\\b',
    '\\bdo not\\s+(flag|warn|report|block|mention)\\b',
    '\\bignoriere\\b[^.]{0,40}\\b(anweisungen|regeln|vorgaben)\\b',
    '\\b(ki|k\\.i\\.)[- ](agent|assistent|einkaufsassistent)\\w*\\b',
    '\\bdu musst\\b|\\bsie müssen\\b',
    '\\b(ignore[zr]?|oublie[zr]?)\\b[^.]{0,40}\\b(instructions|consignes|règles)\\b',
    '\\b(agent|assistant)\\s+(ia|i\\.a\\.)\\b',
    '\\btu dois\\b|\\bvous devez\\b',
    '\\b(cette|la)\\s+boutique\\s+est\\s+(vérifiée|sûre|fiable)\\b',
  ].join('|'),
  'i',
);

/** Hidden-by-design UI: menus, drawers, modals, cookie/consent banners, tabs, carousels, tooltips. */
const UI_CONTEXT_RE =
  /\b(nav|menu|submenu|dropdown|mega|drawer|offcanvas|off-canvas|modal|dialog|popup|popover|cookie|consent|gdpr|cmp|onetrust|cookiebot|usercentrics|tooltip|tab-?pane|tabpanel|accordion|collapse|carousel|slider|slide|swiper|mobile|search|minicart|mini-cart|cart-drawer|toast|notification|announcement|marquee|ticker)\b/i;
const SKIP_LINK_RE = /^(skip|zum (haupt)?inhalt|aller au contenu|passer au contenu|springe)/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Keep hidden text that could matter; drop normal UI. An injection-like text is always kept (it can hide anywhere). */
export function filterHiddenText(candidates: HiddenCandidate[]): HiddenText[] {
  const out: HiddenText[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const text = clean(c.text);
    if (text.length < 12) continue;
    const possibleInjection = INJECTION_RE.test(text);
    if (!possibleInjection) {
      if (c.hashLink && SKIP_LINK_RE.test(text)) continue;
      if (text.length < MIN_HIDDEN_TEXT) continue;
      if (c.linkRatio >= 0.6) continue;
      if (UI_CONTEXT_RE.test(c.context)) continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: text.slice(0, 1000), reason: c.reason, hint: c.hint, possibleInjection });
  }
  // Injection-like first, so the cap never drops them.
  return out.sort((a, b) => Number(b.possibleInjection) - Number(a.possibleInjection)).slice(0, MAX_HIDDEN_PER_PAGE);
}

/**
 * Runs in the page (Playwright `page.evaluate`), so it must be self-contained plain JavaScript. Walks the body; for
 * the outermost element that hides its own text, reports one candidate and skips its children.
 */
export const HIDDEN_TEXT_JS = `() => {
  const out = [];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'SELECT', 'OPTION', 'IFRAME', 'HEAD', 'META', 'LINK']);
  const rgb = (c) => { const m = (c || '').match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const hint = (el) => { let h = el.tagName.toLowerCase(); if (el.id) h += '#' + el.id; const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2); if (cls.length) h += '.' + cls.join('.'); const data = [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-')); if (data) h += '[' + data + ']'; if (el.getAttribute('aria-hidden') === 'true') h += '[aria-hidden]'; return h.slice(0, 120); };
  const context = (el) => { const parts = []; for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) { parts.push(e.tagName.toLowerCase(), e.getAttribute('role') || '', e.id || '', typeof e.className === 'string' ? e.className : '', e.getAttribute('aria-label') || ''); } return parts.join(' ').replace(/[_]/g, '-').slice(0, 400); };
  const textOf = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
  const reasonFor = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none') return 'display_none';
    if (s.visibility === 'hidden' || s.visibility === 'collapse') return 'visibility_hidden';
    if (parseFloat(s.opacity) < 0.05) return 'opacity_0';
    const r = el.getBoundingClientRect();
    if (/rect\\(\\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\\s*\\)/.test(s.clip) || /inset\\(\\s*(50|100)%/.test(s.clipPath)) return 'clipped';
    if ((r.width <= 1 || r.height <= 1) && (s.overflow === 'hidden' || s.overflowX === 'hidden' || s.overflowY === 'hidden') && s.display !== 'contents') return 'clipped';
    if ((s.position === 'absolute' || s.position === 'fixed') && (r.right <= 0 || r.bottom <= 0 || r.left >= 5000 || r.top >= 20000)) return 'offscreen';
    if (parseFloat(s.fontSize) < 2) return 'tiny_font';
    if (r.width === 0 && r.height === 0 && s.display !== 'contents' && s.display !== 'inline') return 'zero_size';
    if (el.getAttribute('aria-hidden') === 'true' && textOf(el).length >= 80) return 'aria_hidden';
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (own) { const fg = rgb(s.color); const bg = bgOf(el); if (fg && fg.a > 0.5 && Math.abs(fg.r - bg.r) + Math.abs(fg.g - bg.g) + Math.abs(fg.b - bg.b) < 24) return 'same_color'; }
    return null;
  };
  let visited = 0;
  const walk = (el) => {
    if (out.length >= 100 || visited++ > 6000 || SKIP.has(el.tagName)) return;
    const text = textOf(el);
    if (!text) return;
    const reason = reasonFor(el);
    if (reason) {
      const linkText = [...el.querySelectorAll('a')].reduce((n, a) => n + textOf(a).length, 0);
      const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
      out.push({ text: text.slice(0, 1000), reason, hint: hint(el), linkRatio: Math.min(1, linkText / text.length), context: context(el), hashLink: href.startsWith('#') });
      return;
    }
    for (const c of el.children) walk(c);
  };
  if (document.body) for (const c of document.body.children) walk(c);
  return out;
}`;
