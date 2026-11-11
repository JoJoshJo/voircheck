import type { Metadata } from 'next';

/**
 * Open Graph / Twitter card for public pages only (landing, How it works, Privacy, Terms) and a generic one for
 * receipts. Never added under /app, and receipts never get their store, amount or verdict in a card: links to them
 * get pasted into chats, and the preview would show it to everyone there.
 */
export const OG_TAGLINE = 'We check the store before your AI pays.';

const IMAGE = { url: '/og.png', width: 1200, height: 630, alt: `VoirCheck: ${OG_TAGLINE}` };

export function shareCard(title = 'VoirCheck'): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: { type: 'website', siteName: 'VoirCheck', title, description: OG_TAGLINE, images: [IMAGE] },
    twitter: { card: 'summary_large_image', title, description: OG_TAGLINE, images: [IMAGE] },
  };
}
