import { describe, expect, it } from 'vitest';
import { GUEST_EMAIL_DOMAIN, isGuestEmail } from './guest';
import { DICTS, fmt } from './i18n';
import { AutopayForm, LangForm } from './profile-input';
import { demoModeFrom, pendingCheckUrl } from './workspace';

describe('settings / onboarding input', () => {
  it('Auto-pay off clears the limit; on requires 1–1000 USD, stored with 2 decimals', () => {
    expect(AutopayForm.parse({})).toEqual({ autopayEnabled: false, autopayLimit: null });
    expect(AutopayForm.parse({ autopay: 'on', limit: '60' })).toEqual({ autopayEnabled: true, autopayLimit: '60.00' });
    expect(AutopayForm.safeParse({ autopay: 'on', limit: '0' }).success).toBe(false);
    expect(AutopayForm.safeParse({ autopay: 'on', limit: '1000.01' }).success).toBe(false);
    expect(AutopayForm.safeParse({ autopay: 'on', limit: 'abc' }).success).toBe(false);
  });
  it('language is en or fr only', () => {
    expect(LangForm.safeParse({ language: 'fr' }).success).toBe(true);
    expect(LangForm.safeParse({ language: 'de' }).success).toBe(false);
  });
});

describe('guest accounts', () => {
  it('are marked by the reserved .invalid email domain', () => {
    expect(isGuestEmail(`guest-abc@${GUEST_EMAIL_DOMAIN}`)).toBe(true);
    expect(isGuestEmail('someone@example.com')).toBe(false);
    expect(isGuestEmail(null)).toBe(false);
  });
});

describe('i18n', () => {
  const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  it('French has every English string, and none left in English', () => {
    expect(keys(DICTS.fr)).toEqual(keys(DICTS.en));
    const en = keys(DICTS.en);
    const get = (d: object, k: string) => k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], d);
    const same = en.filter((k) => get(DICTS.en, k) === get(DICTS.fr, k) && !['common.english', 'common.french', 'evidence.points', 'pay.hours', 'pay.minutes', 'email.verdict', 'riskLog.verdictFilter', 'riskLog.colDate', 'riskLog.colVerdict', 'footer.github'].includes(k));
    expect(same).toEqual([]);
  });
  it('no exclamation marks in UI copy (spec 5.12 tone)', () => {
    expect(JSON.stringify(DICTS)).not.toContain('!');
  });
  it('fmt fills placeholders', () => {
    expect(fmt('Scanned {ago}', { ago: '2 h ago' })).toBe('Scanned 2 h ago');
  });
});

it('Demo mode is ON unless explicitly turned off', () => {
  expect(demoModeFrom(undefined)).toBe(true);
  expect(demoModeFrom('1')).toBe(true);
  expect(demoModeFrom('0')).toBe(false);
});

describe('"Buy through VoirCheck" link', () => {
  it('keeps an http(s) product link for the check box and drops anything else', () => {
    expect(pendingCheckUrl('https://voircheck-stores.onrender.com/s/velbrook-supply/products/zephlet-buds')).toBe('https://voircheck-stores.onrender.com/s/velbrook-supply/products/zephlet-buds');
    for (const bad of [null, '', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@shop.test/', 'not a url', `https://shop.test/${'a'.repeat(2050)}`]) expect(pendingCheckUrl(bad)).toBeNull();
  });
});
