import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicOrigin } from './app-origin';

const forged = new Headers({ host: 'localhost:3000', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' });

afterEach(() => vi.unstubAllEnvs());

describe('publicOrigin: where our links point', () => {
  it('APP_URL wins over any header', () => {
    vi.stubEnv('APP_URL', 'https://voircheck-web.onrender.com/');
    expect(publicOrigin(forged)).toBe('https://voircheck-web.onrender.com');
  });
  it('production without APP_URL fails loudly instead of trusting headers', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => publicOrigin(forged)).toThrow(/APP_URL/);
  });
  it('dev uses the request’s own Host, never X-Forwarded-Host', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(publicOrigin(forged)).toBe('https://localhost:3000');
  });
});
