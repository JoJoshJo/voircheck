/** Demo-mode toggle state (ON by default, spec 5.3). Stored per browser; each request records it on shopping_sessions. */
export const DEMO_COOKIE = 'vc_demo';
export const demoModeFrom = (value: string | undefined) => value !== '0';

/** Our preference cookies (language, Demo mode): nothing secret, still Secure in production (Render is https only). */
export const PREF_COOKIE = { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === 'production' } as const;
