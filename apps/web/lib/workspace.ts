/** Demo-mode toggle state (ON by default, spec 5.3). Stored per browser; each request records it on shopping_sessions. */
export const DEMO_COOKIE = 'vc_demo';
export const demoModeFrom = (value: string | undefined) => value !== '0';
