/**
 * What the money gate and webhook handler read and write. Everything money-related (amount, currency, store)
 * comes from these rows, never from the browser (spec 5.17 #5). Implementations must scope every user-owned
 * read to `userId` (drizzle-store.ts uses ownedBy through shopping_sessions).
 */

export type Verdict = 'SAFE' | 'HOLD' | 'BLOCK';
export type PaymentMode = 'approve' | 'auto';
export type PaymentStatus = 'created' | 'approved' | 'authorized' | 'capture_pending' | 'captured' | 'voided' | 'capture_denied' | 'failed';
export type AuditActor = 'user' | 'agent' | 'system' | 'webhook';

export interface CandidateRow {
  id: string;
  sessionId: string;
  userId: string;
  storeName: string;
  storeUrl: string;
  productTitle: string;
  /** numeric(10,2) as returned by Postgres; null for a pasted link whose price isn't known (never chargeable). */
  price: string | null;
  currency: string;
  source: 'channel3' | 'demo' | 'link';
}

export interface ScanRow {
  id: string;
  url: string;
  verdict: Verdict;
  riskScore: number;
  scannedAt: Date;
  cacheExpiresAt: Date;
}

export interface ProfileRow {
  userId: string;
  autopayEnabled: boolean;
  autopayLimit: string | null;
}

export interface PaymentRow {
  id: string;
  userId: string;
  sessionId: string;
  candidateId: string;
  scanId: string | null;
  paypalOrderId: string;
  authorizationId: string | null;
  captureId: string | null;
  storeSlug: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  mode: PaymentMode;
  overrideUsed: boolean;
  createdAt: Date;
}

export type NewPayment = Omit<PaymentRow, 'id' | 'createdAt'>;
export type PaymentPatch = Partial<Pick<PaymentRow, 'authorizationId' | 'captureId' | 'status' | 'overrideUsed' | 'scanId'>>;

export interface AuditEntry {
  userId: string | null;
  actor: AuditActor;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
}

export type WebhookRecordState = 'new' | 'unprocessed' | 'processed';

export interface GateStore {
  getCandidateForUser(candidateId: string, userId: string): Promise<CandidateRow | null>;
  getScan(scanId: string): Promise<ScanRow | null>;
  getProfile(userId: string): Promise<ProfileRow | null>;
  getActiveVaultToken(userId: string): Promise<{ paypalVaultTokenId: string } | null>;
  /** Token ID and status only; never card or account details. */
  saveVaultToken(userId: string, paypalVaultTokenId: string, status: string): Promise<void>;

  getPaymentForUser(paymentId: string, userId: string): Promise<PaymentRow | null>;
  getPaymentByOrderId(paypalOrderId: string): Promise<PaymentRow | null>;
  /** Idempotent on paypalOrderId: returns the existing row if one already exists. */
  insertPayment(row: NewPayment): Promise<PaymentRow>;
  updatePayment(paymentId: string, patch: PaymentPatch): Promise<PaymentRow>;

  appendAudit(entry: AuditEntry): Promise<void>;
  hasAudit(entity: string, entityId: string, action: string): Promise<boolean>;

  /** Insert keyed on paypal_event_id; reports whether it's new, seen-but-unprocessed (retry), or done. */
  recordWebhookEvent(e: { paypalEventId: string; eventType: string; signatureVerified: boolean; payload: unknown }): Promise<WebhookRecordState>;
  markWebhookProcessed(paypalEventId: string): Promise<void>;
}

/** In-memory store for tests and the sandbox check script. */
export class MemoryGateStore implements GateStore {
  candidates = new Map<string, CandidateRow>();
  scans = new Map<string, ScanRow>();
  profiles = new Map<string, ProfileRow>();
  vaultTokens: Array<{ userId: string; paypalVaultTokenId: string; status: string }> = [];
  payments = new Map<string, PaymentRow>();
  audit: AuditEntry[] = [];
  webhookEvents = new Map<string, { eventType: string; signatureVerified: boolean; payload: unknown; processed: boolean }>();
  private seq = 0;

  async getCandidateForUser(id: string, userId: string) {
    const c = this.candidates.get(id);
    return c && c.userId === userId ? c : null;
  }
  async getScan(id: string) {
    return this.scans.get(id) ?? null;
  }
  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async getActiveVaultToken(userId: string) {
    const t = [...this.vaultTokens].reverse().find((v) => v.userId === userId && v.status === 'VAULTED');
    return t ? { paypalVaultTokenId: t.paypalVaultTokenId } : null;
  }
  async saveVaultToken(userId: string, paypalVaultTokenId: string, status: string) {
    const existing = this.vaultTokens.find((v) => v.paypalVaultTokenId === paypalVaultTokenId);
    if (existing) existing.status = status;
    else this.vaultTokens.push({ userId, paypalVaultTokenId, status });
  }
  async getPaymentForUser(id: string, userId: string) {
    const p = this.payments.get(id);
    return p && p.userId === userId ? p : null;
  }
  async getPaymentByOrderId(orderId: string) {
    return [...this.payments.values()].find((p) => p.paypalOrderId === orderId) ?? null;
  }
  async insertPayment(row: NewPayment) {
    // Check and insert in one synchronous step, like ON CONFLICT in Postgres.
    const existing = [...this.payments.values()].find((p) => p.paypalOrderId === row.paypalOrderId);
    if (existing) return existing;
    const p: PaymentRow = { ...row, id: `pay_${++this.seq}`, createdAt: new Date() };
    this.payments.set(p.id, p);
    return p;
  }
  async updatePayment(id: string, patch: PaymentPatch) {
    const p = this.payments.get(id);
    if (!p) throw new Error(`payment ${id} not found`);
    Object.assign(p, patch);
    return p;
  }
  async appendAudit(entry: AuditEntry) {
    this.audit.push(structuredClone(entry));
  }
  async hasAudit(entity: string, entityId: string, action: string) {
    return this.audit.some((a) => a.entity === entity && a.entityId === entityId && a.action === action);
  }
  async recordWebhookEvent(e: { paypalEventId: string; eventType: string; signatureVerified: boolean; payload: unknown }): Promise<WebhookRecordState> {
    const existing = this.webhookEvents.get(e.paypalEventId);
    if (existing) return existing.processed ? 'processed' : 'unprocessed';
    this.webhookEvents.set(e.paypalEventId, { eventType: e.eventType, signatureVerified: e.signatureVerified, payload: e.payload, processed: false });
    return 'new';
  }
  async markWebhookProcessed(id: string) {
    const e = this.webhookEvents.get(id);
    if (e) e.processed = true;
  }
}
