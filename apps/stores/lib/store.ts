import { getStore, STORE_THEMES, type StoreConfig, type Theme } from '@voircheck/shared/stores';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { HOST_ROUTED_HEADER } from './routing';

export async function loadStore(slug: string): Promise<{ store: StoreConfig; theme: Theme; base: string }> {
  const store = getStore(slug);
  if (!store) notFound();
  const theme = STORE_THEMES[store.theme];
  if (!theme) throw new Error(`No theme "${store.theme}" for store ${slug}`);
  // Host-routed requests (custom domain) use root-relative links; path-routed ones keep /s/[slug].
  const hostRouted = (await headers()).get(HOST_ROUTED_HEADER) === '1';
  return { store, theme, base: hostRouted ? '' : `/s/${store.slug}` };
}

export const href = (base: string, path = '') => `${base}${path}` || '/';

export const formatPrice = (usd: number) => `$${usd.toFixed(2)}`;

/** Where "Buy through VoirCheck" goes: VoirCheck's own check page, with this product's link ready to scan. */
export async function voircheckBuyUrl(base: string, productSlug: string): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  const product = `${proto}://${h.get('host') ?? 'localhost'}${href(base, `/products/${productSlug}`)}`;
  const app = (process.env.VOIRCHECK_APP_URL || 'https://voircheck.com').replace(/\/$/, '');
  return `${app}/check?url=${encodeURIComponent(product)}`;
}
