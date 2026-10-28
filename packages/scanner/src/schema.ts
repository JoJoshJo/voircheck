import { z } from 'zod';

export const MAX_URL_LENGTH = 2048;

/** A store URL: http/https only, length-limited, no embedded credentials (spec 5.17). Host checks happen in ssrf.ts. */
export const StoreUrl = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .refine((s) => {
    try {
      const u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && u.hostname.length > 0;
    } catch {
      return false;
    }
  }, 'must be an http(s) URL without credentials');

export const Peer = z.object({
  url: StoreUrl,
  /** Price for the same item at this peer. If omitted, it's read from the peer page (inside KERNEL). */
  price: z.number().positive().optional(),
  productTitle: z.string().min(1).max(300).optional(),
});
export type Peer = z.infer<typeof Peer>;

export const ScanInput = z.object({
  url: StoreUrl,
  /** The other stores in the same comparison (for the price and clone checks). */
  peers: z.array(Peer).max(5).default([]),
  /** Optional: the item's price/title at this store when the caller already knows it (e.g. from Channel3). */
  price: z.number().positive().optional(),
  productTitle: z.string().min(1).max(300).optional(),
});
export type ScanInput = z.input<typeof ScanInput>;

export const SIGNAL_IDS = ['domain_age', 'ssl_redirects', 'price', 'ai_page', 'threat_list', 'clone'] as const;
export const SignalId = z.enum(SIGNAL_IDS);
export type SignalId = z.infer<typeof SignalId>;

export const SignalStatus = z.enum(['pass', 'warn', 'fail', 'unavailable']);
export type SignalStatus = z.infer<typeof SignalStatus>;

export const SignalResult = z.object({
  id: SignalId,
  status: SignalStatus,
  points: z.number().int().min(0).max(100),
  /** Plain text only; render as text, never HTML (spec 5.17 #6). */
  evidence: z.array(z.string().max(500)).max(20),
});
export type SignalResult = z.infer<typeof SignalResult>;

export const Verdict = z.enum(['SAFE', 'HOLD', 'BLOCK']);
export type Verdict = z.infer<typeof Verdict>;

export const HARD_RULES = ['threat_list_hit', 'no_valid_https', 'young_domain_cheap_price', 'cant_verify'] as const;
export const HardRule = z.enum(HARD_RULES);
export type HardRule = z.infer<typeof HardRule>;

export const ScanResult = z.object({
  url: z.string(),
  domain: z.string(),
  signals: z
    .array(SignalResult)
    .length(SIGNAL_IDS.length)
    .refine((s) => SIGNAL_IDS.every((id, i) => s[i]?.id === id), 'signals must be the six signals in order'),
  score: z.number().int().min(0).max(100),
  verdict: Verdict,
  hardRulesTriggered: z.array(HardRule),
  kernel: z.object({
    sessionId: z.string().nullable(),
    liveViewUrl: z.string().url().optional(),
    replayUrl: z.string().url().optional(),
  }),
  scannedAt: z.string().datetime(),
});
export type ScanResult = z.infer<typeof ScanResult>;
