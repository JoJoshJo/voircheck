import { z } from 'zod';
import { domainInfo } from './domain';
import { HiddenCandidate, HiddenText } from './hidden-text';

/**
 * Multi-page evidence (spec 5.5, prepares the AI signal 5.13). After the homepage, the same KERNEL session opens up
 * to 4 more pages found through the store's OWN links: legal notice, contact/about, returns/shipping/terms, and one
 * product page (EN/DE/FR link text). Plain GET navigations only: no forms, no cart/checkout, no login.
 *
 * Everything read from these pages is UNTRUSTED data (spec 5.13 injection defenses): links come only from <a href>
 * elements (never from page text), facts are extracted with fixed patterns, nothing is executed or followed, and the
 * text only ever reaches a model through `wrapUntrustedPageText`. Facts are evidence only: they don't change scores.
 */

export const EVIDENCE_KINDS = ['legal', 'contact', 'terms', 'product'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const PageLink = z.object({ href: z.string().max(2048), text: z.string().max(200) });
export type PageLink = z.infer<typeof PageLink>;

export const MAX_EVIDENCE_TEXT = 20_000;

/** One extra page as read in KERNEL. */
export const EvidencePage = z.object({
  url: z.string(),
  finalUrl: z.string(),
  kind: z.enum(EVIDENCE_KINDS),
  title: z.string().max(1000),
  visibleText: z.string().max(MAX_EVIDENCE_TEXT),
  /** Includes hidden text (where planted injections hide). */
  fullText: z.string().max(MAX_EVIDENCE_TEXT),
  hiddenCandidates: z.array(HiddenCandidate).max(100).catch([]),
});
export type EvidencePage = z.infer<typeof EvidencePage>;

/** Total time the extra pages may add to a scan; missing or slow pages are skipped. */
export const EVIDENCE_BUDGET_MS = 15_000;

// ---------- which links to open ----------

/** Never opened: anything that changes state or needs an account. */
const FORBIDDEN_RE =
  /cart|basket|checkout|kasse|warenkorb|panier|commande|login|log-in|signin|sign-in|sign_in|anmelden|register|registrier|inscription|account|konto|compte|logout|abmelden|wishlist|merkzettel|search|suche|recherche|password|passwort|newsletter|unsubscribe|add[-_]to[-_]cart|add-to-basket|\/wp-admin|\/admin\b/i;
const FILE_RE = /\.(pdf|zip|docx?|xlsx?|jpe?g|png|gif|webp|svg|mp4|mp3)$/i;

interface KindRule {
  kind: EvidenceKind;
  /** Link-text patterns, best first. */
  text: RegExp[];
  path: RegExp;
}

const RULES: KindRule[] = [
  {
    kind: 'legal',
    text: [/\bimpressum\b|\bimprint\b|legal notice|site notice|mentions l[ée]gales|informations l[ée]gales|anbieterkennzeichnung|legal information/i],
    path: /impressum|imprint|legal-notice|mentions-legales|mentions_legales|informations-legales/i,
  },
  {
    kind: 'contact',
    text: [/\b(contact( us)?|kontakt|nous contacter|contactez-nous)\b/i, /\b(about( us)?|über uns|ueber uns|à propos|a propos|qui sommes[- ]nous|our story|unser team)\b/i],
    path: /contact|kontakt|about|ueber-uns|uber-uns|über-uns|a-propos|qui-sommes/i,
  },
  {
    kind: 'terms',
    text: [
      /return|refund|rückgabe|ruckgabe|rücksendung|widerruf|retour|remboursement|rétractation/i,
      /shipping|delivery|versand|lieferung|livraison|exp[ée]dition/i,
      /\bagb\b|terms|conditions g[ée]n[ée]rales|\bcgv\b|\bcgu\b|geschäftsbedingungen|conditions of sale/i,
    ],
    path: /return|refund|rueckgabe|ruckgabe|widerruf|retour|remboursement|retractation|shipping|delivery|versand|livraison|agb|terms|cgv|conditions/i,
  },
];

/** Product pages by URL shape (Shopify, WooCommerce, Shopware, PrestaShop, Magento-style, our demo stores). */
const PRODUCT_PATH_RE = /\/(products?|produkte?|artikel|item|items|p|dp|produit|produits)\/[^/?#]+\/?$|-p-?\d+(\.html)?$|\/\d{3,}-[^/]+\.html$/i;

/** The store's own scope: same site (private suffixes like onrender.com count as suffixes) and, on our shared demo host, the same /s/<slug>. */
function inScope(link: URL, page: URL): boolean {
  const a = domainInfo(link.href);
  const b = domainInfo(page.href);
  if (!a.site || a.site !== b.site) return false;
  const slug = page.pathname.match(/^\/s\/[^/]+/)?.[0];
  return !slug || link.pathname === slug || link.pathname.startsWith(`${slug}/`);
}

function usable(raw: string, page: URL): URL | null {
  let u: URL;
  try {
    u = new URL(raw, page);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || (u.port && u.port !== '80' && u.port !== '443')) return null;
  u.hash = '';
  if (u.href === page.href.split('#')[0]) return null;
  if (FORBIDDEN_RE.test(u.pathname + u.search) || FILE_RE.test(u.pathname)) return null;
  return inScope(u, page) ? u : null;
}

/** Up to one link per kind, from the store's own anchors only. */
export function pickEvidenceLinks(links: PageLink[], pageUrl: string): Array<{ url: string; kind: EvidenceKind }> {
  const page = new URL(pageUrl);
  const candidates = links.map((l) => ({ url: usable(l.href, page), text: l.text.replace(/\s+/g, ' ').trim() })).filter((c): c is { url: URL; text: string } => !!c.url);
  const taken = new Set<string>();
  const out: Array<{ url: string; kind: EvidenceKind }> = [];
  const take = (kind: EvidenceKind, url: URL) => {
    taken.add(url.href);
    out.push({ url: url.href, kind });
  };
  for (const rule of RULES) {
    const free = candidates.filter((c) => !taken.has(c.url.href));
    const byText = rule.text.map((re) => free.find((c) => c.text.length <= 80 && re.test(c.text))).find(Boolean);
    const pick = byText ?? free.find((c) => rule.path.test(c.url.pathname));
    if (pick) take(rule.kind, pick.url);
  }
  const product = candidates.find((c) => !taken.has(c.url.href) && PRODUCT_PATH_RE.test(c.url.pathname));
  if (product) take('product', product.url);
  return out;
}

/** Drop pages whose navigation ended outside the store's scope (an off-site redirect). */
export function keepInScope(pages: EvidencePage[], pageUrl: string): EvidencePage[] {
  const page = new URL(pageUrl);
  return pages.filter((p) => {
    try {
      return inScope(new URL(p.finalUrl), page);
    } catch {
      return false;
    }
  });
}

// ---------- facts ----------

export const CollectedFacts = z.object({
  companyNames: z.array(z.string().max(160)).max(5),
  addresses: z.array(z.string().max(200)).max(3),
  phones: z.array(z.string().max(40)).max(5),
  emails: z.array(z.object({ address: z.string().max(200), freeMail: z.boolean(), matchesStoreDomain: z.boolean() })).max(5),
  /** True when any contact email is at a free-mail provider (gmail, outlook, gmx...). */
  freeMailContact: z.boolean(),
  registrationIds: z.array(z.object({ type: z.string().max(40), value: z.string().max(60) })).max(8),
  paymentMethods: z.array(z.string().max(40)).max(20),
  returnPolicy: z.boolean(),
  /** Discount percentages seen, highest first. */
  discountsPct: z.array(z.number().int().min(1).max(99)).max(10),
});
export type CollectedFacts = z.infer<typeof CollectedFacts>;

export const CollectedEvidence = z.object({
  pages: z
    .array(
      z.object({
        url: z.string().max(2048),
        kind: z.union([z.enum(EVIDENCE_KINDS), z.literal('home')]),
        title: z.string().max(300),
        /** Hidden-from-people text on this page, quoted as evidence (untrusted; never followed). */
        hiddenText: z.array(HiddenText).max(10).optional(),
      }),
    )
    .max(5),
  facts: CollectedFacts,
});
export type CollectedEvidence = z.infer<typeof CollectedEvidence>;

export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.de', 'outlook.fr', 'hotmail.com', 'hotmail.de', 'hotmail.fr', 'hotmail.co.uk',
  'live.com', 'live.de', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.de', 'yahoo.fr', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'aol.de', 'gmx.de', 'gmx.at', 'gmx.net', 'gmx.com', 'web.de', 'mail.de', 'freenet.de', 't-online.de',
  'mail.com', 'email.com', 'proton.me', 'protonmail.com', 'tutanota.com', 'tuta.io', 'yandex.com', 'yandex.ru', 'mail.ru',
  'qq.com', '163.com', '126.com', 'laposte.net', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'zoho.com', 'gmx.fr',
]);

const PAYMENT_METHODS: Array<[string, RegExp]> = [
  ['PayPal', /\bpaypal\b/i],
  ['Visa', /\bvisa\b/i],
  ['Mastercard', /\bmaster ?card\b/i],
  ['American Express', /\bamerican express\b|\bamex\b/i],
  ['Maestro', /\bmaestro\b/i],
  ['Carte Bancaire', /\bcarte bancaire\b|\bcarte bleue\b/i],
  ['Apple Pay', /\bapple pay\b/i],
  ['Google Pay', /\bgoogle pay\b/i],
  ['Shop Pay', /\bshop ?pay\b/i],
  ['Klarna', /\bklarna\b/i],
  ['Sofort', /\bsofort(überweisung)?\b/i],
  ['giropay', /\bgiropay\b/i],
  ['EPS', /\beps[- ]?(überweisung)?\b/i],
  ['SEPA direct debit', /\bsepa\b|lastschrift|prélèvement/i],
  ['Bank transfer / prepayment', /vorkasse|vorauskasse|banküberweisung|überweisung|bank transfer|wire transfer|virement( bancaire)?/i],
  ['Invoice', /\b(kauf )?auf rechnung\b|\bpay by invoice\b/i],
  ['Cash on delivery', /nachnahme|cash on delivery|contre[- ]remboursement/i],
  ['Crypto', /\bbitcoin\b|\bcrypto(currency|currencies)?\b|\busdt\b/i],
  ['Western Union / gift cards', /western union|moneygram|gift card|geschenkkarte|carte cadeau/i],
];

const RETURN_RE = /return policy|returns\b|refund|right of withdrawal|money[- ]back|widerruf|rückgabe|rücksendung|umtausch|retours?\b|rétractation|remboursement/i;

const LEGAL_FORM =
  /(?<![\p{L}\d])((?:[\p{Lu}\d][\p{L}\d&.'’-]*\s+){0,4}?[\p{Lu}\d][\p{L}\d&.'’-]*)\s+(GmbH(?:\s*&\s*Co\.?\s*KG)?|AG|UG(?:\s*\(haftungsbeschränkt\))?|e\.\s?K\.|KG|OHG|GbR|Ltd\.?|Limited|LLC|Inc\.?|LLP|PLC|S\.?A\.?S\.?U?|SARL|S\.à r\.l\.|EURL|SNC|S\.A\.|SE|B\.V\.|Co\.,?\s?Ltd\.?)(?=$|[\s,.;:)·|])/gu;
const LABEL_WORDS = /^(?:(impressum|imprint|betreiber|anbieter|inhaber|firma|company|operator|société|societe|editeur|éditeur|copyright|©|\(c\)|\d{4}|by|von|der|die|das|the|le|la|les|par|of)\s+)+/i;

const STREET_RE = /[A-ZÄÖÜ][\wäöüß.'-]*(?:\s[\wäöüß.'-]+){0,3}?(?:straße|strasse|str\.|gasse|weg|platz|allee|ring|damm|ufer|markt|steig|zeile)\s*\d+[a-z]?(?:[-/]\d+)?\b|\b\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:rue|avenue|av\.|boulevard|bd|place|chemin|allée|impasse|quai|route)\b[^\n,]{2,60}|\b\d{1,5}\s+[A-Z][\w.]*(?:\s[A-Z][\w.]*){0,3}\s(?:[Ss]treet|St\.|[Rr]oad|Rd\.|[Aa]venue|Ave\.|[Ll]ane|Ln\.|[Dd]rive|Dr\.|[Ww]ay|[Bb]oulevard|Blvd\.)\b/;
const POSTCODE_CITY_RE = /\b(?:(?:D|A|CH|F)-)?\d{4,5}\s+[A-ZÄÖÜÉ][a-zäöüßéèàç]+(?:[- ][A-ZÄÖÜÉ]?[a-zäöüßéèàç]+)?\b/;
const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/;
const US_CITY_ZIP_RE = /\b[A-Z][a-zA-Z .]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;

const PHONE_LABEL_RE = /\b(tel|tél|phone|telefon|téléphone|fon|hotline|mobil|mobile|call|anrufen|appelez)\b|☎|📞/i;
const PHONE_RE = /(?:\+|00)\d{1,3}[\s./-]?(?:\(0\)[\s./-]?)?\d{1,5}(?:[\s./-]?\d{2,5}){1,4}|\(?\b0\d{1,5}\)?[\s./-]?\d{2,}(?:[\s./-]?\d{2,5}){0,3}/g;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;

const REGISTRATION: Array<[string, RegExp]> = [
  ['VAT', /\b(ATU\s?\d{8}|DE\s?\d{9}|FR\s?[0-9A-Z]{2}\s?\d{9}|GB\s?\d{9}(?:\d{3})?|NL\s?\d{9}B\d{2}|BE\s?0?\d{9}|IT\s?\d{11}|ES\s?[A-Z0-9]\d{7}[A-Z0-9]|PL\s?\d{10}|CHE[-\s]?\d{3}\.\d{3}\.\d{3})\b/g],
  ['Commercial register (HRB/HRA)', /\bHR\s?[AB]\s?\d{2,6}(?:\s?[A-Z]{1,2})?\b/g],
  ['Firmenbuch (FN)', /\bFN\s?\d{3,6}\s?[a-z]\b/g],
  ['SIRET/SIREN', /\bSIRE[TN]\s*(?:n°|no\.?|:)?\s*:?\s*(\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?)\b/gi],
  ['RCS', /\bRCS\s+[A-ZÉ][a-zéè-]+(?:\s[A-B])?\s+\d{3}\s?\d{3}\s?\d{3}\b/g],
  ['Company number', /\b(?:company|registration|reg\.?)\s*(?:no\.?|number|nr\.?)\s*:?\s*([A-Z]{2}\d{6}|\d{8})\b/gi],
];

const DISCOUNT_RE =
  /-\s?(\d{1,2})\s?%|(\d{1,2})\s?%\s?(?:off|rabatt|reduziert|günstiger|sparen|de réduction|de remise|moins cher)|(?:bis zu|up to|jusqu['’]à|save|spare|économisez|sale|soldes|rabatt|promo)\s*:?\s*-?\s?(\d{1,2})\s?%/gi;

const uniq = <T>(xs: T[], key: (x: T) => string = String) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Fixed-pattern fact extraction over untrusted page text. Pure; nothing in the text is interpreted as instructions. */
export function extractFacts(texts: string[], storeUrl: string): CollectedFacts {
  const all = texts.join('\n');
  const lines = all.split(/\n+/).map(clean).filter(Boolean);
  const storeSite = domainInfo(storeUrl).registrable;

  const companyNames = uniq(
    lines.flatMap((l) => [...l.matchAll(LEGAL_FORM)].map((m) => clean(`${m[1]!.replace(LABEL_WORDS, '')} ${m[2]}`))).filter((n) => n.split(' ').length >= 2 && n.length <= 160),
  ).slice(0, 5);

  const addresses: string[] = [];
  lines.forEach((l, i) => {
    if (l.length > 200) return;
    const next = lines[i + 1] ?? '';
    if (STREET_RE.test(l)) {
      if (POSTCODE_CITY_RE.test(l) || UK_POSTCODE_RE.test(l) || US_CITY_ZIP_RE.test(l)) addresses.push(l);
      else if (next.length <= 80 && (POSTCODE_CITY_RE.test(next) || UK_POSTCODE_RE.test(next) || US_CITY_ZIP_RE.test(next))) addresses.push(`${l}, ${next}`);
    }
  });

  const phones = uniq(
    lines.flatMap((l) =>
      [...l.matchAll(PHONE_RE)]
        .map((m) => clean(m[0]))
        .filter((p) => {
          const digits = p.replace(/\D/g, '').length;
          return digits >= 8 && digits <= 15 && (/^(\+|00)/.test(p) || PHONE_LABEL_RE.test(l));
        }),
    ),
    (p) => p.replace(/\D/g, ''),
  ).slice(0, 5);

  const deobfuscated = all.replace(/\s*[[(]\s*(at|ät)\s*[\])]\s*/gi, '@').replace(/\s*[[(]\s*(dot|punkt|point)\s*[\])]\s*/gi, '.');
  const emails = uniq([...deobfuscated.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()).filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e)))
    .slice(0, 5)
    .map((address) => {
      const domain = address.split('@')[1]!;
      return { address, freeMail: FREE_MAIL_DOMAINS.has(domain), matchesStoreDomain: !!storeSite && domainInfo(domain).registrable === storeSite };
    });

  const registrationIds = uniq(
    REGISTRATION.flatMap(([type, re]) => [...all.matchAll(re)].map((m) => ({ type, value: clean(m[1] ?? m[0]).slice(0, 60) }))),
    (r) => `${r.type}:${r.value.replace(/\s/g, '')}`,
  ).slice(0, 8);

  const paymentMethods = PAYMENT_METHODS.filter(([, re]) => re.test(all)).map(([name]) => name);

  const discountsPct = [...new Set([...all.matchAll(DISCOUNT_RE)].map((m) => Number(m[1] ?? m[2] ?? m[3])).filter((n) => n >= 5 && n <= 99))]
    .sort((a, b) => b - a)
    .slice(0, 10);

  return {
    companyNames,
    addresses: uniq(addresses).slice(0, 3),
    phones,
    emails,
    freeMailContact: emails.some((e) => e.freeMail),
    registrationIds,
    paymentMethods,
    returnPolicy: RETURN_RE.test(all),
    discountsPct,
  };
}
