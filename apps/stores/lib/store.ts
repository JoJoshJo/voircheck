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
