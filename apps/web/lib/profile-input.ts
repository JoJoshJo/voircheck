import { z } from 'zod';
import { LANGS } from './i18n';

/** Settings/onboarding input. Limit in USD, 1–1000, two decimals. */
export const AutopayForm = z
  .object({
    autopay: z.literal('on').optional(),
    limit: z.string().trim().optional(),
  })
  .transform((v, ctx) => {
    const enabled = v.autopay === 'on';
    if (!enabled) return { autopayEnabled: false, autopayLimit: null as string | null };
    const n = Number(v.limit);
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      ctx.addIssue({ code: 'custom', message: 'limit must be between 1 and 1000' });
      return z.NEVER;
    }
    return { autopayEnabled: true, autopayLimit: n.toFixed(2) };
  });

export const LangForm = z.object({ language: z.enum(LANGS) });
