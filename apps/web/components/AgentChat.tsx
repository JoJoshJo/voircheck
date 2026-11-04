'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AgentEvent, AgentStore } from '../lib/agent-view';
import { fmt, type Dict } from '../lib/i18n';
import { plainVerdict } from '../lib/plain-verdict';
import { scanStage } from '../lib/scan-stage';
import type { ScanView } from '../lib/scan-view';
import { Checkout } from './Checkout';
import { Mascot } from './Mascot';
import { RefundButton } from './RefundButton';
import { SignalIcon, SIGNAL_ORDER, type SignalState } from './SignalIcon';
import { btnPrimary, btnSecondary, input } from './ui';
import { VERDICT_CLASSES } from './Verdict';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string; replies?: string[] }
  | { kind: 'stores'; ids: string[] }
  | { kind: 'refund'; paymentId: string; ref: string; store: string; amount: string; currency: string };

interface StoreState {
  store: AgentStore;
  phase: 'listed' | 'scanning' | 'done' | 'failed';
  signals: Partial<Record<string, SignalState>>;
  scan?: ScanView;
  cached?: boolean;
  failure?: 'rate_limited' | 'failed' | 'unknown_store';
  order?: { paymentId: string; orderId: string; ref?: string };
  refused?: string;
}

/** Applies one server event to the chat state (pure, so it's unit-tested). */
export function applyAgentEvent(state: { items: Item[]; stores: Record<string, StoreState>; payments: Record<string, string> }, e: AgentEvent) {
  const stores = { ...state.stores };
  const patch = (id: string, p: Partial<StoreState>) => {
    if (stores[id]) stores[id] = { ...stores[id]!, ...p };
  };
  switch (e.type) {
    case 'text':
      return { ...state, items: [...state.items, { kind: 'agent' as const, text: e.text }] };
    case 'replies': {
      // Quick replies belong to the agent's latest message; anything else in between drops them.
      const last = state.items.at(-1);
      if (last?.kind !== 'agent') return state;
      return { ...state, items: [...state.items.slice(0, -1), { ...last, replies: e.replies }] };
    }
    case 'stores':
      for (const s of e.stores) stores[s.storeId] = { store: s, phase: 'listed', signals: {} };
      return { ...state, stores, items: [...state.items, { kind: 'stores' as const, ids: e.stores.map((s) => s.storeId) }] };
    case 'scan_start':
      patch(e.storeId, { phase: 'scanning', signals: {} });
      return { ...state, stores };
    case 'scan_signal':
      patch(e.storeId, { signals: { ...stores[e.storeId]?.signals, [e.id]: e.status } });
      return { ...state, stores };
    case 'scan_done':
      patch(e.storeId, { phase: 'done', scan: e.scan, cached: e.cached });
      return { ...state, stores };
    case 'scan_failed':
      patch(e.storeId, { phase: 'failed', failure: e.reason });
      return { ...state, stores };
    case 'order':
      patch(e.storeId, { order: { paymentId: e.paymentId, orderId: e.orderId, ref: e.ref } });
      return { ...state, stores };
    case 'refused':
      patch(e.storeId, { refused: e.reason });
      return { ...state, stores };
    case 'payment':
      return { ...state, payments: { ...state.payments, [e.paymentId]: e.status } };
    case 'refund_offer': {
      // One card per order; the agent offering again just keeps the existing one.
      if (state.items.some((i) => i.kind === 'refund' && i.paymentId === e.paymentId)) return state;
      const item = { kind: 'refund' as const, paymentId: e.paymentId, ref: e.ref, store: e.store, amount: e.amount, currency: e.currency };
      return { ...state, items: [...state.items, item], payments: { ...state.payments, [e.paymentId]: state.payments[e.paymentId] ?? 'captured' } };
    }
    default:
      return state;
  }
}

/** What "Buy this" sends: the person's own words, so the agent orders (HOLD: their explicit go-ahead after seeing it). */
export function buyMessage(t: Dict, storeName: string, verdict: 'SAFE' | 'HOLD') {
  return fmt(verdict === 'HOLD' ? t.agent.buyMessageHold : t.agent.buyMessage, { store: storeName });
}

/** After the refund button worked: the payment's new status plus a confirmation line under the agent's "tap the button". */
export function applyRefundResult(state: { items: Item[]; stores: Record<string, StoreState>; payments: Record<string, string> }, t: Dict, item: { paymentId: string; ref: string }, status: string, amount: string) {
  const line = status === 'refunded' ? fmt(t.agent.refundDoneLine, { amount, ref: item.ref }) : fmt(t.agent.refundPendingLine, { ref: item.ref });
  return { ...state, payments: { ...state.payments, [item.paymentId]: status }, items: [...state.items, { kind: 'agent' as const, text: line }] };
}

const EMPTY = { items: [] as Item[], stores: {} as Record<string, StoreState>, payments: {} as Record<string, string> };
type ChatState = typeof EMPTY;

/** Payment states after which the chat shows the outcome instead of the PayPal button. */
const SETTLED = new Set(['authorized', 'captured', 'capture_pending', 'capture_denied', 'voided', 'cancelled', 'replaced', 'failed', 'expired', 'refund_pending', 'refunded']);

/** The newest prepared order the person hasn't approved yet (no settled payment status), if any. */
export function pendingApproval(chat: { stores: Record<string, StoreState>; payments: Record<string, string> }): StoreState | null {
  const waiting = Object.values(chat.stores).filter((s) => s.order && !SETTLED.has(chat.payments[s.order.paymentId] ?? ''));
  return waiting.at(-1) ?? null;
}

/**
 * The chat survives a trip to the payment page and back (same browser tab): what's on screen plus the conversation ID,
 * whose history the server keeps for 2 hours. A convenience only: storage can be missing or blocked, then the chat
 * just starts empty.
 */
const STORAGE_KEY = 'voircheck.agentChat.v1';
function loadSaved(): { conversationId: string | null; chat: ChatState; fake: boolean } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { conversationId?: unknown; chat?: ChatState; fake?: unknown };
    if (!s.chat || !Array.isArray(s.chat.items) || typeof s.chat.stores !== 'object') return null;
    return { conversationId: typeof s.conversationId === 'string' ? s.conversationId : null, chat: { ...EMPTY, ...s.chat }, fake: s.fake === true };
  } catch {
    return null;
  }
}
function save(v: { conversationId: string | null; chat: ChatState; fake: boolean }) {
  try {
    if (!v.chat.items.length) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Storage blocked or full: the chat still works, it just won't come back after leaving the page.
  }
}

export function AgentChat({ t, lang, clientId, ask = null }: { t: Dict; lang: string; clientId: string; ask?: { text: string; n: number } | null }) {
  const [chat, setChat] = useState(EMPTY);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fake, setFake] = useState(false);
  const conversationId = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  // Back from the payment page: restore the chat, then ask our server where each of its orders stands.
  useEffect(() => {
    const saved = loadSaved();
    restored.current = true;
    if (!saved) return;
    conversationId.current = saved.conversationId;
    setFake(saved.fake);
    setChat(saved.chat);
    const open = Object.values(saved.chat.stores)
      .map((s) => s.order?.paymentId)
      .filter((id): id is string => !!id && !SETTLED.has(saved.chat.payments[id] ?? ''));
    for (const paymentId of open) {
      void fetch('/api/pay/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentId }) })
        .then((r) => (r.ok ? (r.json() as Promise<{ payment?: { status?: string; expired?: boolean } }>) : null))
        .then((b) => {
          const status = b?.payment?.expired ? 'expired' : b?.payment?.status;
          if (status) setChat((c) => ({ ...c, payments: { ...c.payments, [paymentId]: status } }));
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (restored.current && !busy) save({ conversationId: conversationId.current, chat, fake });
  }, [chat, busy, fake]);

  // Keep the newest message in view by scrolling the chat list only, never the page.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat]);

  const errorText = (code: string) => ({ rate: t.agent.errorRate, cap: t.agent.errorCap, busy: t.agent.errorBusy, model: t.agent.errorModel })[code] ?? t.agent.errorGeneric;

  async function send(message: string) {
    if (busy || !message.trim()) return;
    setBusy(true);
    setError(null);
    setText('');
    setChat((c) => ({ ...c, items: [...c.items, { kind: 'user', text: message.trim() }] }));
    try {
      const res = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: conversationId.current, message: message.trim() }) });
      if (!res.body) throw new Error('no body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;
          const e = JSON.parse(raw) as AgentEvent;
          if (e.type === 'conversation') {
            conversationId.current = e.id;
            setFake(e.model === 'fake');
          } else if (e.type === 'error') setError(errorText(e.code));
          else setChat((c) => applyAgentEvent(c, e));
        }
      }
    } catch {
      setError(t.agent.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  // The workspace's "Ask the agent" chip: send its message once per press (n changes on each press).
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (ask) void sendRef.current(ask.text);
  }, [ask]);

  const pending = pendingApproval(chat);

  function reset() {
    conversationId.current = null;
    setChat(EMPTY);
    setError(null);
    save({ conversationId: null, chat: EMPTY, fake });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={list} className="flex-1 space-y-4 overflow-y-auto py-4" role="log" aria-live="polite" aria-label={t.workspace.chatTitle}>
        {chat.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 py-10 text-center">
            <Mascot mood="idle" size={72} />
            <p className="max-w-xs text-[15px] leading-relaxed text-muted">{t.workspace.chatPlaceholder}</p>
            <button type="button" className={btnSecondary} onClick={() => void send(t.agent.example)} disabled={busy}>
              {fmt(t.agent.tryExample, { example: t.agent.example })}
            </button>
          </div>
        ) : (
          chat.items.map((item, i) =>
            item.kind === 'user' ? (
              <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-ink px-4 py-2.5 text-[16px] text-white">
                <span className="sr-only">{t.agent.you}{t.colon} </span>
                {item.text}
              </p>
            ) : item.kind === 'agent' ? (
              <div key={i} className="space-y-3">
                <p className="max-w-[92%] whitespace-pre-line text-[16px] leading-relaxed">
                  <span className="sr-only">{t.agent.agent}{t.colon} </span>
                  {item.text}
                </p>
                {i === chat.items.length - 1 && !busy && !!item.replies?.length && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t.agent.quickReplies}>
                    {item.replies.map((q) => (
                      <button key={q} type="button" onClick={() => void send(q)} className="min-h-11 rounded-full border border-line bg-white px-4 text-left text-[15px] text-ink transition hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : item.kind === 'refund' ? (
              <RefundCard key={i} t={t} lang={lang} item={item} status={chat.payments[item.paymentId] ?? 'captured'} onStatus={(status, amount) => setChat((c) => applyRefundResult(c, t, item, status, amount))} />
            ) : (
              <div key={i} className="space-y-3">
                {item.ids.map((id) => chat.stores[id] && <StoreCard key={id} t={t} lang={lang} clientId={clientId} s={chat.stores[id]!} payments={chat.payments} busy={busy} onBuy={(m) => void send(m)} />)}
              </div>
            ),
          )
        )}
        {busy && (
          <p className="flex items-center gap-2 text-[15px] text-muted" role="status" aria-live="polite">
            <Mascot mood="scanning" size={32} title="" />
            {Object.values(chat.stores).some((x) => x.phase === 'scanning') ? t.stage.shops : t.stage.thinking}
          </p>
        )}
        {error && <p className="text-[14px] text-muted">{error}</p>}
      </div>
      {fake && <p className="mb-2 text-[12px] text-faint">{t.agent.fakeNote}</p>}
      {pending?.order && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-control border border-ink px-3 py-2.5" data-testid="pending-approval">
          <p className="min-w-0 flex-1 text-[13px]">
            {fmt(t.agent.pendingOrder, {
              ref: pending.order.ref ?? '',
              price: pending.store.price ? new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: pending.store.currency }).format(Number(pending.store.price)) : '',
              store: pending.store.storeName,
            })}
          </p>
          <button
            type="button"
            className={`${btnPrimary} !px-4 !text-[14px]`}
            onClick={() => document.getElementById(`order-${pending.order!.paymentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            {t.agent.approveNow}
          </button>
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="agent-input" className="sr-only">
          {t.agent.inputLabel}
        </label>
        <input id="agent-input" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.agent.inputPlaceholder} className={input} autoComplete="off" />
        <button className={btnPrimary} disabled={busy || !text.trim()}>
          {t.agent.send}
        </button>
      </form>
      {chat.items.length > 0 && (
        <button type="button" onClick={reset} disabled={busy} className="mt-1 inline-flex min-h-11 items-center self-start text-[14px] text-muted underline underline-offset-4">
          {t.agent.newChat}
        </button>
      )}
    </div>
  );
}

export function StoreCard({ t, lang, clientId, s, payments, busy, onBuy }: { t: Dict; lang: string; clientId: string; s: StoreState; payments: Record<string, string>; busy: boolean; onBuy: (message: string) => void }) {
  const money = s.store.price ? new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: s.store.currency }).format(Number(s.store.price)) : '—';
  const verdict = s.scan?.verdict;
  const signals = s.scan ? (Object.fromEntries(s.scan.signals.map((x) => [x.id, x.status])) as Record<string, SignalState>) : s.signals;
  const paid = s.order ? payments[s.order.paymentId] : undefined;
  const plain = s.scan ? plainVerdict(t, s.scan) : null;
  return (
    <div className="overflow-hidden rounded-control border border-line bg-white">
      {verdict && plain && (
        <div className={`px-4 py-3 ${VERDICT_CLASSES[verdict]}`}>
          <p className="text-[17px] font-medium leading-snug">{plain.line}</p>
          {plain.ask && <p className="mt-0.5 text-[15px] opacity-90">{plain.ask}</p>}
        </div>
      )}
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[16px] font-medium">
              {s.store.storeName}
              {s.store.demo && <span className="ml-2 whitespace-nowrap rounded-full border border-current px-2 py-0.5 text-[11px] font-normal text-muted">{t.agent.demoStore}</span>}
            </p>
            <p className="truncate text-[14px] text-muted">{s.store.productTitle}</p>
          </div>
          <p className="shrink-0 text-[20px] font-medium">{money}</p>
        </div>
        {s.phase === 'scanning' && (
          <p className="flex items-center gap-2 text-[15px] text-muted" role="status" aria-live="polite">
            <Mascot mood="scanning" size={28} title="" />
            {scanStage(t, signals)}
          </p>
        )}
        {s.phase === 'failed' && <p className="text-[14px] text-muted">{s.failure === 'rate_limited' ? t.agent.scanRate : t.agent.scanFailed}</p>}
        {s.scan && !s.order && !s.refused && (s.scan.verdict === 'SAFE' || s.scan.verdict === 'HOLD') && (
          <button type="button" className={`${btnPrimary} min-h-12 w-full !text-[16px]`} disabled={busy} onClick={() => onBuy(buyMessage(t, s.store.storeName, s.scan!.verdict as 'SAFE' | 'HOLD'))}>
            {s.scan.verdict === 'HOLD' ? t.agent.buyAnyway : t.agent.buyThis}
          </button>
        )}
        {(s.phase === 'scanning' || s.phase === 'done') && (
          <details open={s.phase === 'scanning'}>
            <summary className="flex min-h-11 cursor-pointer items-center text-[15px] text-ink underline underline-offset-4">{t.plain.why}</summary>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1" aria-label={s.phase === 'scanning' ? t.agent.scanning : t.evidence.title}>
              {SIGNAL_ORDER.map((id) => {
                const st = signals[id] ?? 'pending';
                return (
                  <li key={id} className="flex items-center gap-1.5 text-[13px] text-muted" title={t.signals[`status_${st}`]}>
                    <SignalIcon state={st} />
                    {t.signals[id]}
                    <span className="sr-only">: {t.signals[`status_${st}`]}</span>
                  </li>
                );
              })}
            </ul>
            {s.scan && (
              <p className="pt-2 text-[13px] text-muted">
                {s.cached ? `${t.agent.cachedScan} · ` : ''}
                <Link href={`/app/scans/${s.scan.id}`} className="inline-flex min-h-11 items-center text-ink underline underline-offset-4">
                  {t.workspace.viewEvidence}
                </Link>
              </p>
            )}
          </details>
        )}
        {s.refused && <p className="text-[14px] font-medium">{fmt(t.agent.refused, { reason: t.agent[`reason_${s.refused}` as 'reason_other'] ?? t.agent.reason_other })}</p>}
        {s.order && s.scan && (
          <div id={`order-${s.order.paymentId}`} className="space-y-3 border-t border-line pt-3">
            {paid === 'captured' ? (
              <div className="space-y-1" role="status">
                <p className="text-[16px] font-medium">{t.agent.paidTitle}</p>
                <p className="text-[15px] leading-relaxed text-muted">{fmt(t.agent.paidBody, { amount: money, store: s.store.storeName, ref: s.order.ref ?? '' })}</p>
              </div>
            ) : (
              <>
                <p className="text-[15px] font-medium">{t.agent.payTitle}</p>
                <p className="text-[14px] leading-relaxed text-muted">{t.agent.payBody}</p>
                {s.order.ref && <p className="text-[14px] text-muted">{fmt(t.agent.orderRef, { ref: s.order.ref })}</p>}
                {paid && <p className="text-[14px] text-muted">{fmt(t.agent.paymentStatus, { status: t.agent[`st_${paid}` as 'st_failed'] ?? paid })}</p>}
              </>
            )}
            {paid === 'captured' ? (
              <Link href="/app/history" className="inline-flex min-h-11 items-center text-[15px] text-ink underline underline-offset-4">
                {t.agent.openHistory}
              </Link>
            ) : paid && SETTLED.has(paid) ? (
              <Link href={`/app/pay/${s.order.paymentId}?from=chat`} className="inline-flex min-h-11 items-center text-[15px] text-ink underline underline-offset-4">
                {t.agent.seePayment}
              </Link>
            ) : (
              <Checkout key={s.order.paymentId} t={t} lang={lang} clientId={clientId} candidateId={s.store.storeId} scanId={s.scan.id} autopay={false} existingOrder={s.order} from="chat" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RefundCard({ t, lang, item, status, onStatus }: { t: Dict; lang: string; item: Extract<Item, { kind: 'refund' }>; status: string; onStatus: (status: string, amount: string) => void }) {
  const amount = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: item.currency }).format(Number(item.amount));
  return (
    <div className="space-y-2 rounded-control border border-line bg-white px-4 py-3">
      <p className="text-[15px] font-medium">{fmt(t.refund.title, { ref: item.ref })}</p>
      <p className="text-[13px] text-muted">
        {item.store} · {amount}
      </p>
      {status === 'captured' && <p className="text-[13px] leading-relaxed text-muted">{t.refund.body}</p>}
      {status === 'captured' || status === 'refunded' || status === 'refund_pending' ? (
        <RefundButton t={t} paymentId={item.paymentId} refLabel={item.ref} amount={amount} status={status} onStatus={(next) => onStatus(next, amount)} />
      ) : (
        <p className="text-[13px] text-muted">{t.refund.notRefundable}</p>
      )}
    </div>
  );
}
