// @voircheck/paypal — PayPal REST (sandbox only), server-side money gate, verified webhooks (spec 5.7 / 5.17).
// captureAuthorization and chargeVaultedWallet are deliberately NOT exported: money only moves through MoneyGate.
export { PayPalClient, PayPalApiError, PAYPAL_SANDBOX_BASE_URL, TOKEN_REFRESH_MARGIN_MS, type PayPalClientOptions } from './client';
export { createOrder, getOrder, authorizeOrder, voidAuthorization, approvalLink, firstAuthorization, firstCapture, toMoney, type Order, type CreateOrderInput, type Money } from './orders';
export {
  MoneyGate,
  decideCapture,
  decideAutopay,
  decideReauthorize,
  effectiveVerdict,
  scanCoversStore,
  storeSlugFor,
  requestIdFor,
  StartPurchaseInput,
  AutopayInput,
  UserCaptureInput,
  PaymentActionInput,
  type EffectiveVerdict,
  type CaptureDecision,
  type GateResult,
  type MoneyGateOptions,
} from './gate';
export { handleWebhook, verifyWebhookSignature, type WebhookOutcome, type WebhookEvent } from './webhooks';
export { MemoryGateStore, type GateStore, type CandidateRow, type ScanRow, type PaymentRow, type PaymentStatus, type Verdict } from './store';
export { drizzleGateStore } from './drizzle-store';
