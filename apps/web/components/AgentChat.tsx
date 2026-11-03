'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AgentEvent, AgentStore } from '../lib/agent-view';
import { fmt, type Dict } from '../lib/i18n';
import { scoreLine } from '../lib/score-line';
import type { ScanView } from '../lib/scan-view';
import { Checkout } from './Checkout';
import { Mascot } from './Mascot';
import { RefundButton } from './RefundButton';
import { SignalIcon, SIGNAL_ORDER, type SignalState } from './SignalIcon';
import { btnPrimary, btnSecondary, input } from './ui';
import { VERDICT_CLASSES, VerdictLabel } from './Verdict';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
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

const EMPTY = { items: [] as Item[], stores: {} as Record<string, StoreState>, payments: {} as Record<string, string> };
type ChatState = typeof EMPTY;

/** Payment states after which the chat shows the outcome instead of the PayPal button. */
const SETTLED = new Set(['authorized', 'captured', 'capture_pending', 'capture_denied', 'voided', 'cancelled', 'failed', 'expired', 'refund_pending', 'refunded']);

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

export function AgentChat({ t, lang, clientId }: { t: Dict; lang: string; clientId: string }) {
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

  function reset() {
    conversationId.current = null;
    setChat(EMPTY);
    setError(null);
    save({ conversationId: null, chat: EMPTY, fake });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={list} className="flex-1 space-y-4 overflow-y-auto py-4">
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
              <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-ink px-4 py-2.5 text-[15px] text-white">
                <span className="sr-only">{t.agent.you}{t.colon} </span>
                {item.text}
              </p>
            ) : item.kind === 'agent' ? (
              <p key={i} className="max-w-[92%] whitespace-pre-line text-[15px] leading-relaxed">
                <span className="sr-only">{t.agent.agent}{t.colon} </span>
                {item.text}
              </p>
            ) : item.kind === 'refund' ? (
              <RefundCard key={i} t={t} lang={lang} item={item} status={chat.payments[item.paymentId] ?? 'captured'} onStatus={(status) => setChat((c) => ({ ...c, payments: { ...c.payments, [item.paymentId]: status } }))} />
            ) : (
              <div key={i} className="space-y-3">
                {item.ids.map((id) => chat.stores[id] && <StoreCard key={id} t={t} lang={lang} clientId={clientId} s={chat.stores[id]!} payments={chat.payments} />)}
              </div>
            ),
          )
        )}
        {busy && <p className="text-[14px] text-muted">{t.agent.working}</p>}
        {error && <p className="text-[14px] text-muted">{error}</p>}
      </div>
      {fake && <p className="mb-2 text-[12px] text-faint">{t.agent.fakeNote}</p>}
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
        <button type="button" onClick={reset} disabled={busy} className="mt-2 self-start text-[13px] text-muted underline underline-offset-4">
          {t.agent.newChat}
        </button>
      )}
    </div>
  );
}

function StoreCard({ t, lang, clientId, s, payments }: { t: Dict; lang: string; clientId: string; s: StoreState; payments: Record<string, string> }) {
  const money = s.store.price ? new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: s.store.currency }).format(Number(s.store.price)) : '—';
  const verdict = s.scan?.verdict;
  const signals = s.scan ? (Object.fromEntries(s.scan.signals.map((x) => [x.id, x.status])) as Record<string, SignalState>) : s.signals;
  const paid = s.order ? payments[s.order.paymentId] : undefined;
  return (
    <div className="overflow-hidden rounded-control border border-line bg-white">
      <div className={`flex items-start justify-between gap-3 px-4 py-3 ${verdict ? VERDICT_CLASSES[verdict] : ''}`}>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium">
            {s.store.storeName}
            {s.store.demo && <span className="ml-2 rounded-full border border-current px-2 py-0.5 text-[11px] font-normal opacity-70">{t.agent.demoStore}</span>}
          </p>
          <p className="truncate text-[13px] opacity-80">
            {s.store.productTitle} · {money}
          </p>
        </div>
        {verdict && (
          <div className="shrink-0 text-right">
            <VerdictLabel verdict={verdict} t={t} />
            <p className="text-[12px] opacity-80">
              {scoreLine(t, s.scan!)}
            </p>
          </div>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        {(s.phase === 'scanning' || s.phase === 'done') && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label={s.phase === 'scanning' ? t.agent.scanning : t.evidence.title}>
            {SIGNAL_ORDER.map((id) => {
              const st = signals[id] ?? 'pending';
              return (
                <li key={id} className="flex items-center gap-1.5 text-[12px] text-muted" title={t.signals[`status_${st}`]}>
                  <SignalIcon state={st} />
                  {t.signals[id]}
                </li>
              );
            })}
          </ul>
        )}
        {s.phase === 'failed' && <p className="text-[13px] text-muted">{s.failure === 'rate_limited' ? t.agent.scanRate : t.agent.scanFailed}</p>}
        {s.scan && (
          <p className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
            <span>{s.cached ? t.agent.cachedScan : ''}</span>
            <Link href={`/app/scans/${s.scan.id}`} className="text-ink underline underline-offset-4">
              {t.workspace.viewEvidence}
            </Link>
          </p>
        )}
        {s.refused && <p className="text-[14px] font-medium">{fmt(t.agent.refused, { reason: t.agent[`reason_${s.refused}` as 'reason_other'] ?? t.agent.reason_other })}</p>}
        {s.order && s.scan && (
          <div className="space-y-3 border-t border-line pt-3">
            <p className="text-[14px] font-medium">{t.agent.payTitle}</p>
            <p className="text-[13px] leading-relaxed text-muted">{t.agent.payBody}</p>
            {s.order.ref && <p className="text-[13px] text-muted">{fmt(t.agent.orderRef, { ref: s.order.ref })}</p>}
            {paid && <p className="text-[13px] text-muted">{fmt(t.agent.paymentStatus, { status: t.agent[`st_${paid}` as 'st_failed'] ?? paid })}</p>}
            {paid && SETTLED.has(paid) ? (
              <Link href={`/app/pay/${s.order.paymentId}?from=chat`} className="text-[13px] text-ink underline underline-offset-4">
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

function RefundCard({ t, lang, item, status, onStatus }: { t: Dict; lang: string; item: Extract<Item, { kind: 'refund' }>; status: string; onStatus: (status: string) => void }) {
  const amount = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: item.currency }).format(Number(item.amount));
  return (
    <div className="space-y-2 rounded-control border border-line bg-white px-4 py-3">
      <p className="text-[15px] font-medium">{fmt(t.refund.title, { ref: item.ref })}</p>
      <p className="text-[13px] text-muted">
        {item.store} · {amount}
      </p>
      {status === 'captured' && <p className="text-[13px] leading-relaxed text-muted">{t.refund.body}</p>}
      {status === 'captured' || status === 'refunded' || status === 'refund_pending' ? (
        <RefundButton t={t} paymentId={item.paymentId} refLabel={item.ref} amount={amount} status={status} onStatus={onStatus} />
      ) : (
        <p className="text-[13px] text-muted">{t.refund.notRefundable}</p>
      )}
    </div>
  );
}
