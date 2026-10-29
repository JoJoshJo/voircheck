/**
 * PayPal REST client: OAuth client-credentials token cache (refreshed before expiry), idempotent writes
 * (`PayPal-Request-Id` required on every POST), `Prefer: return=representation`. Sandbox only (CLAUDE.md).
 * Never logs or returns the client secret or the access token.
 */

export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

/** Refresh this long before PayPal's `expires_in` (sandbox tokens last ~9h per the spike). */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

export class PayPalApiError extends Error {
  override name = 'PayPalApiError';
  constructor(
    readonly status: number,
    /** PayPal error name, e.g. UNPROCESSABLE_ENTITY. */
    readonly errorName: string,
    /** First detail issue, e.g. REAUTHORIZATION_TOO_SOON. */
    readonly issue: string | null,
    readonly debugId: string | null,
    message: string,
  ) {
    super(message);
  }
}

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface ErrorBody {
  name?: string;
  message?: string;
  error?: string;
  error_description?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string }>;
}

function toError(status: number, body: ErrorBody | null): PayPalApiError {
  const name = body?.name ?? body?.error ?? `HTTP_${status}`;
  const issue = body?.details?.[0]?.issue ?? null;
  const msg = [`PayPal ${status} ${name}`, body?.message ?? body?.error_description, issue && `[${issue}]`, body?.debug_id && `(debug_id ${body.debug_id})`]
    .filter(Boolean)
    .join(' ');
  return new PayPalApiError(status, name, issue, body?.debug_id ?? null, msg);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class PayPalClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(private readonly opts: PayPalClientOptions) {
    this.baseUrl = (opts.baseUrl ?? PAYPAL_SANDBOX_BASE_URL).replace(/\/$/, '');
    if (new URL(this.baseUrl).hostname !== new URL(PAYPAL_SANDBOX_BASE_URL).hostname) {
      throw new Error('PayPal client is sandbox-only (api-m.sandbox.paypal.com)');
    }
    if (!opts.clientId || !opts.clientSecret) throw new Error('PayPal client id/secret missing');
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  /** Cached token; concurrent callers share one refresh. */
  async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS) return this.token.value;
    this.pendingToken ??= this.fetchToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  /**
   * Browser-safe client token for the JS SDK v6 (response_type=client_token), scoped to the given page hostnames
   * (bare hostnames like "voircheck-web.onrender.com"; PayPal rejects origins and localhost).
   * Safe to send to the browser; the server access token never is.
   */
  async browserClientToken(domains: string[]): Promise<{ token: string; expiresIn: number }> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials', response_type: 'client_token' });
    if (domains.length) body.set('domains[]', domains.join(','));
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
    });
    const json = (await readJson(res)) as { access_token?: string; expires_in?: number } & ErrorBody;
    if (!res.ok || !json?.access_token) throw toError(res.status, json);
    return { token: json.access_token, expiresIn: json.expires_in ?? 3600 };
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
    });
    const body = (await readJson(res)) as { access_token?: string; expires_in?: number } & ErrorBody;
    if (!res.ok || !body?.access_token) throw toError(res.status, body);
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  /**
   * One API call. Every POST needs a `requestId`: PayPal returns the original result for a repeated id, so a
   * retry or a double click can't create a second order, capture or void.
   */
  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, opts: { body?: unknown; requestId?: string } = {}): Promise<T> {
    if (method === 'POST' && !opts.requestId) throw new Error(`PayPal POST ${path} needs a PayPal-Request-Id`);
    const send = async () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await this.accessToken()}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      };
      if (opts.requestId) headers['paypal-request-id'] = opts.requestId;
      return this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      });
    };
    let res = await send();
    if (res.status === 401) {
      // Token revoked or expired early: refresh once and replay (same request id, so still idempotent).
      this.token = null;
      res = await send();
    }
    const body = await readJson(res);
    if (!res.ok) throw toError(res.status, body as ErrorBody | null);
    return body as T;
  }
}
