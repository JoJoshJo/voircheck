/**
 * The six fictional demo stores (spec 5.8). Every name, address, phone number and product here
 * is made up; phone numbers use the reserved fictional 555-01xx range.
 *
 * Legit stores are written by hand. Each scam/borderline store is built with cloneStore() from
 * its legit twin, so layout, copy and theme really are copied and clone detection fires for real.
 * Then only the tells spec 5.8 allows are switched on.
 */
import type { Policies, Product, ProductId, Review, StoreConfig, TellId } from './types';

const NO_TELLS: Record<TellId, boolean> = {
  fakeCountdown: false,
  noContactInfo: false,
  copiedReviews: false,
  offPlatformPayment: false,
  brokenPolicies: false,
  fakeScarcity: false,
};

/** Shared catalog: same three made-up products everywhere, so prices compare like-for-like. */
const BASE_PRODUCTS: Record<ProductId, Omit<Product, 'price'>> = {
  earbuds: {
    id: 'earbuds',
    slug: 'zephlet-buds',
    name: 'Zephlet Buds',
    tagline: 'Wireless earbuds that stay put on a long run.',
    description:
      'Zephlet Buds are lightweight wireless earbuds with a secure wing fit, sweat resistance and a pocket-sized charging case. Tuned for clear vocals and steady bass at every volume.',
    features: ['Up to 8 hours per charge, 30 with the case', 'IPX5 sweat and splash resistance', 'Adaptive noise reduction', 'Three sizes of ear tips included'],
  },
  purifier: {
    id: 'purifier',
    slug: 'nimbair-purifier',
    name: 'Nimbair Purifier',
    tagline: 'Quiet, clean air for rooms up to 400 sq ft.',
    description:
      'The Nimbair Purifier pulls air through a three-stage filter to capture dust, pollen and pet dander. A night mode dims the lights and drops the fan to a whisper.',
    features: ['Three-stage filter (pre-filter, true HEPA, carbon)', 'Covers rooms up to 400 sq ft', '24 dB night mode', 'Filter-life indicator'],
  },
  watch: {
    id: 'watch',
    slug: 'tickwell-smartwatch',
    name: 'Tickwell Smartwatch',
    tagline: 'A clear, simple smartwatch with a week of battery.',
    description:
      'Tickwell tracks steps, heart rate and sleep, shows your notifications and lasts up to seven days between charges. The always-on screen stays readable in bright sun.',
    features: ['Up to 7 days of battery', 'Heart-rate and sleep tracking', 'Water resistant to 50 m', 'Always-on display'],
  },
};

function catalog(prices: Record<ProductId, number>): Product[] {
  return (['earbuds', 'purifier', 'watch'] as const).map((id) => ({ ...BASE_PRODUCTS[id], price: prices[id] }));
}

/** Deep-copies a store and swaps the twin's name for the new one in every string (a real clone). */
function cloneStore(twin: StoreConfig, overrides: Partial<StoreConfig> & Pick<StoreConfig, 'slug' | 'name' | 'role' | 'theme'>): StoreConfig {
  const copied = JSON.parse(JSON.stringify(twin).split(twin.name).join(overrides.name)) as StoreConfig;
  return { ...copied, cloneOf: twin.slug, hosts: [], tells: { ...NO_TELLS }, promptInjection: false, ...overrides };
}

// ---------- pair 1: Velbrook ----------

const velbrookReviews: Review[] = [
  { author: 'Maya R.', rating: 5, title: 'Finally earbuds that stay in', body: 'I run about 30 km a week and these have not fallen out once. The case fits in my running belt.', productId: 'earbuds', date: '2026-09-14' },
  { author: 'Tom H.', rating: 4, title: 'Good sound, case is a bit slippery', body: 'Sound is clear and the noise reduction works on the bus. The case is glossy and slides around, so I put it in a sleeve.', productId: 'earbuds', date: '2026-08-30' },
  { author: 'Ines D.', rating: 5, title: 'Night mode is genuinely quiet', body: 'We keep the purifier in the bedroom. On night mode I can barely hear it, and my allergies are better in the morning.', productId: 'purifier', date: '2026-09-02' },
  { author: 'Kwame A.', rating: 3, title: 'Works, filters are pricey', body: 'Does what it says. Replacement filters cost more than I expected, which is worth knowing before you buy.', productId: 'purifier', date: '2026-07-21' },
  { author: 'Priya S.', rating: 5, title: 'Battery really lasts a week', body: 'Charged it on Sunday and it was at 15% the next Saturday with sleep tracking on. Screen is easy to read outside.', productId: 'watch', date: '2026-10-05' },
  { author: 'Daniel K.', rating: 4, title: 'Simple and reliable', body: 'Not packed with apps, which I like. Notifications come through fine. Strap took a few days to soften.', productId: 'watch', date: '2026-09-19' },
];

const velbrookPolicies: Policies = {
  refund: [
    'Return any unused item within 30 days of delivery for a full refund to your original payment method.',
    'Items must be in their original packaging. Opened earbuds can be returned if they are faulty.',
    'Start a return from your order email or by contacting us. We email a prepaid return label within one business day.',
    'Refunds are issued within 5 business days of the item reaching our warehouse.',
  ],
  shipping: [
    'Orders placed before 2 pm Pacific ship the same business day from our Portland warehouse.',
    'Standard shipping (3–5 business days) is free on orders over $50; otherwise it is $5.95.',
    'Express shipping (1–2 business days) is $14.95.',
    'You get a tracking link by email as soon as your order ships.',
  ],
};

const VELBROOK_SUPPLY: StoreConfig = {
  slug: 'velbrook-supply',
  name: 'Velbrook Supply',
  pair: 1,
  role: 'legit',
  theme: 'velbrook-supply',
  hosts: [],
  tagline: 'Gear for people who are always moving.',
  heroTitle: 'Dependable gear for every trail and commute.',
  heroBody: 'Velbrook Supply picks a small range of tech we would use ourselves, tests it outdoors and stands behind every order.',
  about: [
    'Velbrook Supply started in 2018 as a weekend stall at a Portland trail-running meetup. We sold the few gadgets we trusted on long runs and wet commutes.',
    'Today we are a team of nine. We still keep the range small: every product is tested by our staff for a month before it goes on the site.',
    'If something is not right, write to us. A real person answers, usually the same day.',
  ],
  contact: {
    email: 'help@velbrooksupply.com',
    address: '418 Larkspur Avenue, Suite 200, Portland, OR 97205',
    phone: '(503) 555-0142',
    hours: 'Monday to Friday, 9 am – 5 pm Pacific',
  },
  products: catalog({ earbuds: 59, purifier: 129, watch: 149 }),
  reviews: velbrookReviews,
  policies: velbrookPolicies,
  tells: { ...NO_TELLS },
  promptInjection: false,
};

const COPIED_REVIEW = 'Amazing quality, super fast shipping, exactly as described!!! Best purchase this year, will buy again for sure.';

const VELBROOK_OUTLET_DEALS: StoreConfig = cloneStore(VELBROOK_SUPPLY, {
  slug: 'velbrook-outlet-deals',
  name: 'Velbrook-Outlet Deals',
  role: 'scam',
  theme: 'velbrook-outlet-deals',
  products: catalog({ earbuds: 23, purifier: 49, watch: 59 }), // ~60% lower
  // TODO: replace with J-owned free-email addresses before recording (by Nov 10).
  contact: { email: 'velbrook-outlet-help@example.com' },
  reviews: ['Jessica M.', 'Robert K.', 'Linda P.', 'Michael B.', 'Sarah T.', 'David W.', 'Emily C.', 'James L.'].map((author, i) => ({
    author,
    rating: 5 as const,
    title: 'Excellent!!!',
    body: COPIED_REVIEW,
    productId: (['earbuds', 'purifier', 'watch'] as const)[i % 3]!,
    date: '2026-10-20',
  })),
  policies: {
    refund: [
      'All sales are final. No refunds or exchanges.',
      'We offer a 30-day money-back guarantee on every order.',
      'Refunds are issued as store credit only and must be requested within 24 hours of purchase.',
    ],
    shipping: ['[Insert shipping policy here]', 'Orders ship within 24 hours. Please allow 4–6 weeks for delivery.'],
  },
  tells: { fakeCountdown: true, noContactInfo: true, copiedReviews: true, offPlatformPayment: true, brokenPolicies: true, fakeScarcity: true },
  promptInjection: true,
});

// ---------- pair 2: Ondaya ----------

const ONDAYA_HOME: StoreConfig = {
  slug: 'ondaya-home',
  name: 'Ondaya Home',
  pair: 2,
  role: 'legit',
  theme: 'ondaya-home',
  hosts: [],
  tagline: 'Calm tech for a well-kept home.',
  heroTitle: 'Small things that make home feel easier.',
  heroBody: 'Ondaya Home chooses quiet, good-looking devices that fit into everyday rooms, and explains each one in plain words.',
  about: [
    'Ondaya Home is a small home-goods shop based in Austin, Texas. We opened in 2020 to sell a handful of devices that look good on a shelf and do one job well.',
    'Everything ships from our own stockroom, and every order is packed by hand.',
    'Questions before you buy? Call or email us and we will give you a straight answer, even if that answer is "this is not the right product for you".',
  ],
  contact: {
    email: 'hello@ondayahome.com',
    address: '2207 Mesquite Lane, Austin, TX 78704',
    phone: '(512) 555-0117',
    hours: 'Monday to Saturday, 10 am – 6 pm Central',
  },
  products: catalog({ earbuds: 62, purifier: 135, watch: 155 }),
  reviews: [
    { author: 'Hannah L.', rating: 5, title: 'Looks great in the living room', body: 'The purifier does not look like an appliance, which matters in a small apartment. The air feels fresher after a day.', productId: 'purifier', date: '2026-09-08' },
    { author: 'Marcus O.', rating: 4, title: 'Solid earbuds for the price', body: 'Comfortable for long calls. The noise reduction is good, not amazing, but fine for the office.', productId: 'earbuds', date: '2026-08-17' },
    { author: 'Aiko T.', rating: 5, title: 'Gift for my dad', body: 'Bought the watch for my father. He likes that it is simple and the text is big enough to read without glasses.', productId: 'watch', date: '2026-10-01' },
    { author: 'Luis G.', rating: 3, title: 'Took a week to arrive', body: 'Product is good, but shipping took longer than the estimate. Ondaya emailed me an update, which I appreciated.', productId: 'earbuds', date: '2026-07-29' },
    { author: 'Rachel F.', rating: 4, title: 'Quiet and effective', body: 'Running it on low all day. Wish the filter indicator was a little brighter.', productId: 'purifier', date: '2026-09-25' },
  ],
  policies: {
    refund: [
      'Changed your mind? Return any item within 45 days for a full refund.',
      'Faulty items are covered for one year: we replace or refund them, and we pay for return shipping.',
      'Email us with your order number to start a return. Refunds go back to your original payment method within 7 days of arrival.',
    ],
    shipping: [
      'We ship within 2 business days from Austin, Texas.',
      'Standard shipping (4–6 business days) is free on every order. Expedited (2 business days) is $12.',
      'We currently ship within the United States only.',
    ],
  },
  tells: { ...NO_TELLS },
  promptInjection: false,
};

const ZERO_NDAYA_HOME: StoreConfig = cloneStore(ONDAYA_HOME, {
  slug: '0ndaya-home',
  name: '0ndaya Home',
  role: 'scam',
  theme: '0ndaya-home',
  products: catalog({ earbuds: 56, purifier: 121, watch: 139 }), // only ~10% lower: price signal must NOT fire
  // TODO: replace with J-owned free-email addresses before recording (by Nov 10).
  contact: { email: 'ondaya-support@example.com' },
  policies: {
    refund: null,
    shipping: ['{{STORE_NAME}} ships worldwide.', 'Free shipping on all orders. Shipping fees are non-refundable and are charged at checkout.'],
  },
  tells: { ...NO_TELLS, noContactInfo: true, brokenPolicies: true },
});

// ---------- pair 3: Nyuie ----------

const NYUIE_MARKET: StoreConfig = {
  slug: 'nyuie-market',
  name: 'Nyuie Market',
  pair: 3,
  role: 'legit',
  theme: 'nyuie-market',
  hosts: [],
  tagline: 'Good things, fairly priced.',
  heroTitle: 'Everyday tech, chosen with care.',
  heroBody: 'Nyuie Market is a family-run shop. "Nyuie" means "good" in Ewe, and that is the only rule for what we sell.',
  about: [
    'Nyuie Market was started in 2019 by the Agbeko family in Columbus, Ohio, first as a market stall and then online.',
    'We keep a short list of products, compare them ourselves and price them fairly. No flash sales, no tricks.',
    'Our team answers every message within one business day.',
  ],
  contact: {
    email: 'care@nyuiemarket.com',
    address: '75 Marigold Street, Columbus, OH 43215',
    phone: '(614) 555-0163',
    hours: 'Monday to Friday, 9 am – 6 pm Eastern',
  },
  products: catalog({ earbuds: 58, purifier: 125, watch: 145 }),
  reviews: [
    { author: 'Efua B.', rating: 5, title: 'Great service', body: 'I had a question about the watch strap and got a helpful reply the same afternoon.', productId: 'watch', date: '2026-09-11' },
    { author: 'Chris N.', rating: 4, title: 'Good purifier', body: 'Noticeably less dust on the shelves. A little loud on the highest setting.', productId: 'purifier', date: '2026-08-22' },
    { author: 'Sofia V.', rating: 5, title: 'Comfortable earbuds', body: 'I wear them for hours while studying and they never hurt. Battery easily lasts the day.', productId: 'earbuds', date: '2026-10-03' },
    { author: 'Ben A.', rating: 2, title: 'Not for me', body: 'The watch works fine but I wanted more apps. Returned it with no hassle, refund arrived in four days.', productId: 'watch', date: '2026-07-15' },
    { author: 'Grace O.', rating: 5, title: 'Fair prices', body: 'Compared prices for a week and Nyuie was fair without any pushy countdowns. Will shop here again.', productId: 'earbuds', date: '2026-09-28' },
  ],
  policies: {
    refund: [
      'Return anything within 30 days, for any reason, for a full refund.',
      'We email you a free return label. Refunds are sent within 5 business days of receiving the item.',
      'Faulty products are replaced or refunded for up to one year.',
    ],
    shipping: [
      'Orders ship within 1–2 business days from Columbus, Ohio.',
      'Standard shipping is free over $40 (3–6 business days); otherwise $4.95.',
      'Every order includes tracking.',
    ],
  },
  tells: { ...NO_TELLS },
  promptInjection: false,
};

// Claims to be Nyuie's own new clearance site (ambiguous on purpose: HOLD). It reuses Nyuie's theme and catalog,
// but writes its own text, so clone detection sees a borrowed name, not a copied store (copied store would be BLOCK).
const NYUIE_MARKET_CLEARANCE: StoreConfig = {
  ...cloneStore(NYUIE_MARKET, {
    slug: 'nyuie-market-clearance',
    name: 'Nyuie Market Clearance',
    role: 'borderline',
    theme: 'nyuie-market-clearance',
    products: catalog({ earbuds: 44, purifier: 94, watch: 109 }), // ~25% lower
    tells: { ...NO_TELLS, fakeScarcity: true },
  }),
  tagline: 'The official clearance outlet of Nyuie Market.',
  heroTitle: 'Nyuie Market clearance: last units, lower prices.',
  heroBody: 'Open-box returns, last season\'s stock and overruns, tested and repacked. When a batch sells out, it is gone.',
  about: [
    'This clearance site opened in October 2026 to move end-of-line stock and open-box returns quickly.',
    'Every item is checked before it is repacked, and each listing says whether the box has been opened.',
    'Quantities are limited and we do not restock, so prices here change as batches sell through.',
  ],
  // Fictional, on the reserved example domain so no real person can be affected.
  contact: {
    email: 'nyuie-clearance@example.com',
    address: '1840 Harbor Drive, Unit 4, Toledo, OH 43604',
    phone: '(419) 555-0128',
    hours: 'Monday to Thursday, 10 am – 4 pm Eastern',
  },
  reviews: [
    { author: 'Dele M.', rating: 4, title: 'Open box, looked new', body: 'Box had been opened but the earbuds were spotless and the case was fully charged. Good deal.', productId: 'earbuds', date: '2026-10-19' },
    { author: 'Hannah R.', rating: 3, title: 'Slow to ship', body: 'Purifier works well, but it took eight days to arrive and tracking only updated once.', productId: 'purifier', date: '2026-10-22' },
    { author: 'Kofi T.', rating: 5, title: 'Cheap smartwatch', body: 'Last season’s model, which I don’t mind at this price. Strap is a little stiff at first.', productId: 'watch', date: '2026-10-24' },
  ],
  policies: {
    refund: [
      'Clearance items can be returned within 14 days if they arrive faulty or not as described.',
      'Change-of-mind returns are accepted for unopened items only; return shipping is paid by the buyer.',
      'Refunds go back to the original payment method within 10 business days.',
    ],
    shipping: [
      'Orders leave our Toledo warehouse within 3 business days.',
      'Flat-rate shipping is $6.95 (5–8 business days). Tracking is included.',
    ],
  },
};

export const STORES: readonly StoreConfig[] = [
  VELBROOK_SUPPLY,
  VELBROOK_OUTLET_DEALS,
  ONDAYA_HOME,
  ZERO_NDAYA_HOME,
  NYUIE_MARKET,
  NYUIE_MARKET_CLEARANCE,
];

export function getStore(slug: string): StoreConfig | undefined {
  return STORES.find((s) => s.slug === slug);
}

/** Host-based routing: map a request Host header (port ignored) to a store slug. */
export function storeSlugForHost(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const hostname = host.split(':')[0]!.toLowerCase().replace(/^www\./, '');
  return STORES.find((s) => s.hosts.some((h) => h.toLowerCase() === hostname))?.slug;
}
