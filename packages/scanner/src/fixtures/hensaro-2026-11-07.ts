import type { PageSnapshot } from '../kernel';
import type { ComparableOffer } from '../signals/price';

/**
 * hensaro.com, found by J through a Google Shopping ad on 2026-11-07 (eval/misses/2026-11-07-hensaro.md).
 * Test data only: no live calls.
 *
 * 1. SENT_AWAY: what our cloud browser really got on 2026-11-08 00:34 UTC (stored scan b57de438): the product link
 *    ended on www.google.com (Google's German consent page, title "Google", H1 "Bevor Sie zu Google weitergehen"),
 *    with hensaro's whole query string copied onto it.
 * 2. RECONSTRUCTED_PRODUCT_PAGE: the product page as J described it (Canon PowerShot SX740 HS at about $77, a Costco banner on a
 *    non-Costco domain). RECONSTRUCTED from that description, not copied: our scanner never saw the real page
 *    (see 1), and VoirCheck never opens store pages outside KERNEL.
 */

export const HENSARO_AD_URL =
  'https://hensaro.com/products/canon-powershot-sx740-hs-digital-camera-black-wnsre11755bm?currency=USD&country=US&variant=42899115409454&utm_source=google&utm_medium=cpc&utm_campaign=Google+Shopping&stkn=effaa8ae5ae4&gad_source=1&gad_campaignid=24433167729&gclid=CjwKCAiAtbvXBhB_EiwAjwv9JnoJxYfTab9n9jje3Q-89aEABfoDhlM8Ug1Luvr1Ye1BGkMiUSugUxoCMJQQAvD_BwE&utm_content=lumvireta';
export const HENSARO_CLEAN_URL = 'https://hensaro.com/products/canon-powershot-sx740-hs-digital-camera-black-wnsre11755bm?currency=USD&country=US&variant=42899115409454';
export const HENSARO_REGISTERED = '2026-07-01T00:00:00Z';
export const HENSARO_SCANNED = '2026-11-08T00:34:15Z';

const GOOGLE_TEXT = 'Bevor Sie zu Google weitergehen Wir verwenden Cookies und Daten, um Dienste von Google bereitzustellen und zu betreiben. Alle ablehnen Alle akzeptieren Weitere Optionen Datenschutz Nutzungsbedingungen';

export const SENT_AWAY: PageSnapshot = {
  requestedUrl: HENSARO_CLEAN_URL,
  finalUrl: 'https://www.google.com/?currency=USD&country=US&variant=42899115409454',
  redirectChain: [HENSARO_CLEAN_URL, 'https://www.google.com/?currency=USD&country=US&variant=42899115409454'],
  httpStatus: 200,
  title: 'Google',
  siteName: 'Google',
  h1: 'Bevor Sie zu Google weitergehen',
  visibleText: GOOGLE_TEXT,
  fullText: GOOGLE_TEXT,
  structure: ['body', 'div', 'h1', 'p', 'button', 'button', 'a'],
  aboutUrl: null,
  aboutText: null,
  links: [{ href: 'https://policies.google.com/terms?hl=de&fg=1', text: 'Nutzungsbedingungen' }],
  hiddenCandidates: [],
  pageFacts: { ldJson: [], metaPrice: null, metaTitle: null, logoAlts: ['Google'], bannerText: '' },
};

const PRODUCT_TEXT = [
  'Costco Wholesale | Member Exclusive: Extra Savings Today Only',
  'Home / Cameras / Digital Cameras',
  'Canon PowerShot SX740 HS Digital Camera (Black)',
  '$77.00 $699.99 Save 89%',
  'Only 3 left in stock! 27 people are viewing this item.',
  '40x optical zoom, 4K video, 20.3 MP CMOS sensor, built-in Wi-Fi and Bluetooth.',
  'Add to cart Buy it now',
  'Free shipping on all orders. 30-day returns.',
].join('\n');

/**
 * NOT CAPTURED EVIDENCE. Rebuilt from J's description of the page (2026-11-07) so the price, retailer-on-page and AI
 * rules can be tested; the real page was never seen by the scanner. Never cite it as what hensaro.com showed.
 */
export const RECONSTRUCTED_PRODUCT_PAGE: PageSnapshot = {
  requestedUrl: HENSARO_CLEAN_URL,
  finalUrl: HENSARO_CLEAN_URL,
  redirectChain: [HENSARO_CLEAN_URL],
  httpStatus: 200,
  title: 'Canon PowerShot SX740 HS Digital Camera (Black) – Costco',
  siteName: 'Costco',
  h1: 'Canon PowerShot SX740 HS Digital Camera (Black)',
  visibleText: PRODUCT_TEXT,
  fullText: PRODUCT_TEXT,
  structure: ['body', 'div', 'header', 'img', 'nav', 'main', 'h1', 'p', 'button', 'footer'],
  aboutUrl: null,
  aboutText: null,
  links: [],
  hiddenCandidates: [],
  pageFacts: {
    ldJson: [
      JSON.stringify({
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: 'Canon PowerShot SX740 HS Digital Camera (Black)',
        brand: { '@type': 'Brand', name: 'Canon' },
        offers: { '@type': 'Offer', price: '77.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      }),
    ],
    metaPrice: { amount: '77.00', currency: 'USD' },
    metaTitle: 'Canon PowerShot SX740 HS Digital Camera (Black)',
    logoAlts: ['Costco Wholesale'],
    bannerText: 'Costco Wholesale | Member Exclusive: Extra Savings Today Only',
  },
};

/** Other stores' offers for the same camera, as a product search (Channel3) might return them. Made-up prices. */
export const SX740_OFFERS: ComparableOffer[] = [
  { title: 'Canon PowerShot SX740 HS Digital Camera (Black)', price: 649, currency: 'USD', storeUrl: 'https://www.bhphotovideo.com/' },
  { title: 'Canon PowerShot SX740 HS 20.3MP 40x Zoom Camera - Black', price: 679.99, currency: 'USD', storeUrl: 'https://www.adorama.com/' },
  { title: 'Canon - PowerShot SX740 HS 20.3-Megapixel Digital Camera - Black', price: 699.99, currency: 'USD', storeUrl: 'https://www.bestbuy.com/' },
  { title: 'Canon PowerShot SX740 HS Black', price: 629, currency: 'USD', storeUrl: 'https://www.walmart.com/' },
  { title: 'Case for Canon PowerShot SX740 HS', price: 19.99, currency: 'USD', storeUrl: 'https://www.amazon.com/' },
  { title: 'Canon PowerShot SX720 HS Digital Camera', price: 299, currency: 'USD', storeUrl: 'https://www.ebay.com/' },
  { title: 'Canon PowerShot SX740 HS Digital Camera (Black)', price: 75, currency: 'USD', storeUrl: 'https://cheap-cams.example/' , verdict: 'BLOCK' },
  { title: 'Canon PowerShot SX740 HS Digital Camera (Black)', price: 77, currency: 'USD', storeUrl: 'https://hensaro.com/' },
];

// ---------- research step (web search) fixtures: made up for tests, on example domains only ----------
// No real site's words are reproduced or invented here: the "sources" are .example placeholders.

/** A web_search_tool_result block as the API returns it (encrypted_content shortened). */
export const searchBlock = (results: Array<{ url: string; title: string }>) => ({
  type: 'web_search_tool_result' as const,
  tool_use_id: 'srvtoolu_test',
  content: results.map((r) => ({ type: 'web_search_result' as const, url: r.url, title: r.title, encrypted_content: 'x', page_age: null })),
});

export const REPUTATION_RESULTS = [
  { url: 'https://reviews.example/review/hensaro.com', title: 'hensaro.com reviews | reviews.example' },
  { url: 'https://forum.example/t/hensaro-never-delivered', title: 'Ordered a camera from hensaro.com, never arrived' },
  { url: 'https://hensaro.com/pages/reviews', title: 'Hensaro – Customer reviews' },
];

/** What the model answers: two sourced warnings, one finding on the shop's own site, one made-up source. */
export const REPUTATION_ANSWER = {
  findings: [
    { kind: 'scam_report', source_url: 'https://reviews.example/review/hensaro.com/', note_en: 'Reviewers call it a fake shop.', note_fr: 'Des avis la décrivent comme une fausse boutique.' },
    { kind: 'complaint', source_url: 'https://forum.example/t/hensaro-never-delivered', note_en: 'A buyer says the camera never arrived.', note_fr: 'Un acheteur dit que l’appareil n’est jamais arrivé.' },
    { kind: 'positive_review', source_url: 'https://hensaro.com/pages/reviews', note_en: 'Five-star reviews on its own site.', note_fr: 'Des avis cinq étoiles sur son propre site.' },
    { kind: 'positive_review', source_url: 'https://trusted-reviews.example/hensaro', note_en: 'Great shop!', note_fr: 'Super boutique !' },
  ],
  summary_en: 'Two other sites report problems with this shop.',
  summary_fr: 'Deux autres sites signalent des problèmes avec cette boutique.',
};

export const PRICE_RESULTS = [
  { url: 'https://camera-store-a.example/canon-sx740-black', title: 'Canon PowerShot SX740 HS Black – Store A' },
  { url: 'https://camera-store-b.example/p/sx740', title: 'Canon PowerShot SX740 HS – Store B' },
  { url: 'https://camera-store-c.example/sx740hs', title: 'Canon SX740 HS digital camera – Store C' },
];

export const PRICE_ANSWER = {
  offers: [
    { source_url: 'https://camera-store-a.example/canon-sx740-black', product_title: 'Canon PowerShot SX740 HS Digital Camera Black', price: 649, currency: 'USD' },
    { source_url: 'https://camera-store-b.example/p/sx740', product_title: 'Canon PowerShot SX740 HS Digital Camera (Black)', price: 679, currency: 'USD' },
    { source_url: 'https://camera-store-c.example/sx740hs', product_title: 'Canon PowerShot SX740 HS Digital Camera', price: 659, currency: 'USD' },
    { source_url: 'https://made-up-store.example/sx740', product_title: 'Canon PowerShot SX740 HS Digital Camera', price: 9, currency: 'USD' },
  ],
};
