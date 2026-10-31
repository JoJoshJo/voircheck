import { describe, expect, it } from 'vitest';
import { browserCreateParams } from './kernel';

describe('KERNEL browser settings', () => {
  it('never uses stealth mode (it always loads the CAPTCHA solver), with or without a proxy', () => {
    expect(browserCreateParams({})).toMatchObject({ stealth: false });
    expect(browserCreateParams({ proxyId: 'prx_1' })).toMatchObject({ stealth: false, proxy: { id: 'prx_1' } });
  });
  it('routes through the ISP proxy only when one is configured', () => {
    expect(browserCreateParams({})).not.toHaveProperty('proxy');
    expect(browserCreateParams({ proxyId: '' })).not.toHaveProperty('proxy');
  });
});
