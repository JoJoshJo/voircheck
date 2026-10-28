import type { demoStores } from './schema';

/** The six fictional demo stores (spec 5.8). Domains are set later, once bought. */
export const DEMO_STORES: (typeof demoStores.$inferInsert)[] = [
  { slug: 'velbrook-supply', name: 'Velbrook Supply', pair: 1, role: 'legit', theme: 'velbrook-supply', domain: null },
  { slug: 'velbrook-outlet-deals', name: 'Velbrook-Outlet Deals', pair: 1, role: 'scam', theme: 'velbrook-outlet-deals', domain: null },
  { slug: 'ondaya-home', name: 'Ondaya Home', pair: 2, role: 'legit', theme: 'ondaya-home', domain: null },
  { slug: '0ndaya-home', name: '0ndaya Home', pair: 2, role: 'scam', theme: '0ndaya-home', domain: null },
  { slug: 'nyuie-market', name: 'Nyuie Market', pair: 3, role: 'legit', theme: 'nyuie-market', domain: null },
  { slug: 'nyuie-market-clearance', name: 'Nyuie Market Clearance', pair: 3, role: 'borderline', theme: 'nyuie-market-clearance', domain: null },
];
