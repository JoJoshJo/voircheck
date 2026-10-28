export type StoreRole = 'legit' | 'scam' | 'borderline';

/** The six planted scam tells (spec 5.8). Always real page content, never faked signal values. */
export type TellId =
  | 'fakeCountdown' // 1. countdown timer that resets on reload
  | 'noContactInfo' // 2. no address/phone, free-email address only
  | 'copiedReviews' // 3. same review text under different names
  | 'offPlatformPayment' // 4. "extra 15% off with gift card / crypto / bank transfer" (text only)
  | 'brokenPolicies' // 5. missing, copy-pasted or contradictory policies
  | 'fakeScarcity'; // 6. "only 2 left" / "43 viewing" that never change

export const TELL_IDS: readonly TellId[] = [
  'fakeCountdown',
  'noContactInfo',
  'copiedReviews',
  'offPlatformPayment',
  'brokenPolicies',
  'fakeScarcity',
];

export type ProductId = 'earbuds' | 'purifier' | 'watch';

export interface Product {
  id: ProductId;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  price: number; // USD
}

export interface Contact {
  email: string;
  address?: string;
  phone?: string;
  hours?: string;
}

export interface Review {
  author: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  productId: ProductId;
  date: string; // ISO date
}

/** null = the policy page is missing. */
export interface Policies {
  refund: string[] | null;
  shipping: string[] | null;
}

export type Layout = 'classic' | 'split' | 'bold';

export interface Theme {
  layout: Layout;
  colors: {
    bg: string;
    surface: string;
    ink: string;
    muted: string;
    accent: string;
    accentInk: string;
    border: string;
  };
  headingFont: string;
  bodyFont: string;
  radius: string;
}

export interface StoreConfig {
  slug: string; // must match db demo_stores seed
  name: string;
  pair: 1 | 2 | 3;
  role: StoreRole;
  theme: string; // key into STORE_THEMES (same key as the db seed)
  cloneOf?: string; // slug of the legit twin this store copies
  /** Hostnames that route to this store (set when domains are bought). */
  hosts: string[];
  tagline: string;
  heroTitle: string;
  heroBody: string;
  about: string[];
  contact: Contact;
  products: Product[];
  reviews: Review[];
  policies: Policies;
  tells: Record<TellId, boolean>;
  /** Hidden prompt-injection text for the AI-safety showcase (spec 5.13). Velbrook-Outlet only. */
  promptInjection: boolean;
}
