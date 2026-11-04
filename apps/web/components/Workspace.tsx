'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { fmt, type Dict } from '../lib/i18n';
import { scoreLine } from '../lib/score-line';
import type { CandidateView, ScanEvent, ScanView } from '../lib/scan-view';
import { AgentChat } from './AgentChat';
import { Checkout } from './Checkout';
import { CHECK_AUTO_COOKIE, CHECK_COOKIE, DEMO_COOKIE } from '../lib/workspace';
import { Mascot } from './Mascot';
import { SignalIcon, SIGNAL_ORDER, type SignalState } from './SignalIcon';
import { btnPrimary, btnSecondary, card, input } from './ui';
import { VERDICT_CLASSES, VerdictLabel } from './Verdict';

type ScanState =
  | { phase: 'idle' }
  | { phase: 'scanning'; url: string; signals: Partial<Record<string, SignalState>>; liveViewUrl: string | null }
  | { phase: 'done'; scan: ScanView; candidate: CandidateView; cached: boolean }
  | { phase: 'error'; code: string; url?: string };

export function timeAgo(iso: string, t: Dict, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t.workspace.justNow;
  if (mins < 60) return fmt(t.workspace.minutesAgo, { n: mins });
  return fmt(t.workspace.hoursAgo, { n: Math.floor(mins / 60) });
}

export function Workspace({
  t,
  lang,
  clientId,
  initialDemoMode,
  autopay,
  initialCheck = null,
  autoStart = false,
  demoLinks,
}: {
  t: Dict;
  lang: string;
  clientId: string;
  initialDemoMode: boolean;
  autopay: boolean;
  initialCheck?: string | null;
  autoStart?: boolean;
  /** One-click "try it" links to our fictional demo stores (shown in Demo mode while nothing is checked yet). */
  demoLinks?: { safe: string; scam: string };
}) {
  // "Ask the agent" chip: a message for the chat to send, with a counter so the same text can be asked again.
  const [ask, setAsk] = useState<{ text: string; n: number } | null>(null);
  const [tab, setTab] = useState<'chat' | 'results'>(initialCheck ? 'results' : 'chat');
  const [demoMode, setDemoMode] = useState(initialDemoMode);
  const [url, setUrl] = useState(initialCheck ?? '');
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    document.cookie = `${DEMO_COOKIE}=${demoMode ? '1' : '0'}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
  }, [demoMode]);

  // A link from "Buy through VoirCheck" or the extension is used once: forget it so the next visit starts empty.
  useEffect(() => {
    if (initialCheck) document.cookie = `${CHECK_COOKIE}=; path=/; max-age=0`;
    if (autoStart) document.cookie = `${CHECK_AUTO_COOKIE}=; path=/; max-age=0`;
  }, [initialCheck, autoStart]);

  async function run(target: string, rescan = false) {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setTab('results');
    setState({ phase: 'scanning', url: target, signals: {}, liveViewUrl: null });
    try {
      const res = await fetch('/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target, rescan }), signal: ctrl.signal });
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
          const e = JSON.parse(raw) as ScanEvent;
          setState((s) => {
            if (e.type === 'cached') return { phase: 'done', scan: e.scan, candidate: e.candidate, cached: true };
            if (e.type === 'done') return { phase: 'done', scan: e.scan, candidate: e.candidate, cached: false };
            if (e.type === 'error') return { phase: 'error', code: e.code, url: target };
            if (s.phase !== 'scanning') return s;
            if (e.type === 'browser') return { ...s, liveViewUrl: e.liveViewUrl };
            if (e.type === 'signal') return { ...s, signals: { ...s.signals, [e.id]: e.status } };
            return s;
          });
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setState({ phase: 'error', code: 'failed', url: target });
    }
  }

  // /check marked this link to start on arrival (the signed-in person's own navigation, e.g. the extension): run it
  // once. Limits and daily caps still apply in /api/scans.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || !initialCheck || autoStarted.current) return;
    autoStarted.current = true;
    void run(initialCheck);
  }, [autoStart, initialCheck]);

  const tabBtn = (id: 'chat' | 'results', text: string) => (
    <button type="button" onClick={() => setTab(id)} className={`flex-1 rounded-full py-2 text-[14px] font-medium ${tab === id ? 'bg-ink text-white' : 'text-muted'}`}>
      {text}
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="mb-4 flex gap-1 rounded-full bg-surface p-1 lg:hidden">
        {tabBtn('chat', t.workspace.tabChat)}
        {tabBtn('results', t.workspace.tabResults)}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* LEFT: chat */}
        <section className={`${card} flex max-h-[85vh] min-h-[540px] flex-col p-6 ${tab === 'chat' ? '' : 'hidden lg:flex'}`} aria-label={t.workspace.chatTitle}>
          <h2 className="text-[17px] font-medium">{t.workspace.chatTitle}</h2>
          <AgentChat t={t} lang={lang} clientId={clientId} ask={ask} />
        </section>

        {/* RIGHT: results */}
        <section className={`${tab === 'results' ? '' : 'hidden lg:block'} space-y-5`} aria-label={t.workspace.resultsTitle}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[17px] font-medium">{t.workspace.resultsTitle}</h2>
            <label className="flex items-center gap-3 text-[14px]" title={t.workspace.demoModeHint}>
              <span className="text-muted">{t.workspace.demoMode}</span>
              <button
                type="button"
                role="switch"
                aria-checked={demoMode}
                onClick={() => setDemoMode((d) => !d)}
                className={`relative h-6 w-11 rounded-full transition ${demoMode ? 'bg-ink' : 'bg-line'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${demoMode ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
          {demoMode && <p className="-mt-3 px-1 text-[13px] text-faint">{t.workspace.demoModeLine}</p>}

          <form
            className={`${card} p-5`}
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) void run(url.trim());
            }}
          >
            <label htmlFor="check-link" className="mb-2 block text-[14px] font-medium">
              {t.workspace.checkLinkTitle}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="check-link" type="url" inputMode="url" required maxLength={2048} placeholder={t.workspace.checkLinkPlaceholder} value={url} onChange={(e) => setUrl(e.target.value)} className={input} />
              <button className={btnPrimary} disabled={state.phase === 'scanning'}>
                {state.phase === 'scanning' ? t.workspace.checking : t.workspace.check}
              </button>
            </div>
          </form>

          {state.phase === 'idle' && <p className="px-1 text-[15px] text-muted">{initialCheck && url === initialCheck ? t.workspace.checkReady : t.workspace.empty}</p>}
          {state.phase === 'idle' && demoMode && demoLinks && (
            <div className="space-y-2 px-1" data-testid="try-demo">
              <p className="text-[13px] text-faint">{t.workspace.tryTitle}</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    [t.workspace.trySafe, demoLinks.safe],
                    [t.workspace.tryScam, demoLinks.scam],
                  ] as const
                ).map(([label, link]) => (
                  <button
                    key={link}
                    type="button"
                    className={btnSecondary}
                    onClick={() => {
                      setUrl(link);
                      void run(link);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => {
                    setTab('chat');
                    setAsk((a) => ({ text: t.agent.example, n: (a?.n ?? 0) + 1 }));
                  }}
                >
                  {t.workspace.tryAgent}
                </button>
              </div>
            </div>
          )}
          {state.phase === 'scanning' && <ScanningCard t={t} url={state.url} signals={state.signals} liveViewUrl={state.liveViewUrl} />}
          {state.phase === 'done' && (
            <>
              <ResultCard t={t} scan={state.scan} cached={state.cached} onRescan={() => void run(state.scan.url, true)} />
              <BuyCard t={t} lang={lang} clientId={clientId} scan={state.scan} candidate={state.candidate} autopay={autopay} />
            </>
          )}
          {state.phase === 'error' && (
            <div className={`${card} p-5 text-[15px] text-muted`}>
              {state.code === 'rate' ? t.workspace.errorRate : state.code === 'cap' ? t.workspace.errorCap : state.code === 'url' ? t.workspace.errorUrl : t.workspace.errorGeneric}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Checklist({ t, signals }: { t: Dict; signals: Partial<Record<string, SignalState>> }) {
  return (
    <ul className="divide-y divide-line">
      {SIGNAL_ORDER.map((id) => {
        const s = signals[id] ?? 'pending';
        return (
          <li key={id} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-[15px]">{t.signals[id]}</span>
            <span className="flex items-center gap-2 text-[13px] text-muted">
              {t.signals[`status_${s}`]}
              <SignalIcon state={s} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ScanningCard({ t, url, signals, liveViewUrl }: { t: Dict; url: string; signals: Partial<Record<string, SignalState>>; liveViewUrl: string | null }) {
  return (
    <div className={`${card} relative p-5`}>
      <div className="absolute -top-7 right-6">
        <Mascot mood="scanning" size={64} title={t.workspace.checking} />
      </div>
      <p className="truncate pr-20 text-[13px] text-faint">{url}</p>
      <div className="mt-3">
        <Checklist t={t} signals={signals} />
      </div>
      <LiveView t={t} url={liveViewUrl} />
    </div>
  );
}

function LiveView({ t, url }: { t: Dict; url: string | null }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-[13px] font-medium text-muted">{t.workspace.liveView}</p>
      <div className="aspect-[16/10] overflow-hidden rounded-control border border-line bg-surface">
        {url ? (
          <iframe src={url} title={t.workspace.liveView} className="h-full w-full" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-faint">{t.workspace.checking}</div>
        )}
      </div>
      <p className="mt-2 text-[12px] text-faint">{t.workspace.liveViewNote}</p>
    </div>
  );
}

/** Product, price, store and "Pay with PayPal" when we know the price; otherwise a plain explanation. */
export function BuyCard({ t, lang, clientId, scan, candidate, autopay }: { t: Dict; lang: string; clientId: string; scan: ScanView; candidate: CandidateView; autopay: boolean }) {
  // BLOCK: say plainly that VoirCheck won't pay; the usual checkout (with its own Pay anyway step) stays one click away.
  const [anyway, setAnyway] = useState(false);
  if (candidate.price && scan.verdict === 'BLOCK' && !anyway)
    return (
      <div className={`${card} space-y-3 p-5`} data-testid="blocked-buy">
        <p className="text-[16px] font-medium">{t.pay.blockedTitle}</p>
        <p className="text-[14px] leading-relaxed text-muted">{t.pay.blockedBody}</p>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <Link href={`/app/scans/${scan.id}`} className={btnPrimary}>
            {t.workspace.viewEvidence}
          </Link>
          <button type="button" onClick={() => setAnyway(true)} className="text-[13px] text-muted underline underline-offset-4">
            {t.pay.blockedAnyway}
          </button>
        </div>
      </div>
    );
  if (!candidate.price) return <div className={`${card} p-5 text-[14px] leading-relaxed text-muted`}>{t.pay.noPrice}</div>;
  const money = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: candidate.currency }).format(Number(candidate.price));
  return (
    <div className={`${card} space-y-5 p-5`}>
      <dl className="grid grid-cols-3 gap-4 text-[14px]">
        <div>
          <dt className="text-faint">{t.pay.product}</dt>
          <dd className="mt-1 font-medium">{candidate.productTitle}</dd>
        </div>
        <div>
          <dt className="text-faint">{t.pay.price}</dt>
          <dd className="mt-1 font-medium">{money}</dd>
        </div>
        <div>
          <dt className="text-faint">{t.pay.store}</dt>
          <dd className="mt-1 font-medium">{candidate.storeName}</dd>
        </div>
      </dl>
      <Checkout key={`${scan.id}-${candidate.id}`} t={t} lang={lang} clientId={clientId} candidateId={candidate.id} scanId={scan.id} autopay={autopay} />
    </div>
  );
}

function ResultCard({ t, scan, cached, onRescan }: { t: Dict; scan: ScanView; cached: boolean; onRescan: () => void }) {
  const signals = Object.fromEntries(scan.signals.map((s) => [s.id, s.status])) as Record<string, SignalState>;
  return (
    <div className={`${card} relative overflow-hidden`}>
      <div className={`flex items-center justify-between gap-4 px-5 py-5 ${VERDICT_CLASSES[scan.verdict]}`}>
        <div>
          <VerdictLabel verdict={scan.verdict} t={t} />
          <p className="mt-1 text-[16px] font-medium">{t.verdict[`${scan.verdict}_line`]}</p>
          <p className="mt-1 text-[13px] opacity-80">
            {scoreLine(t, scan)}
          </p>
        </div>
        <Mascot mood={scan.verdict} size={72} title={t.verdict[scan.verdict]} />
      </div>
      <div className="p-5">
        <p className="truncate text-[13px] text-faint">{scan.url}</p>
        <div className="mt-2">
          <Checklist t={t} signals={signals} />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">
            {fmt(t.workspace.scannedAgo, { ago: timeAgo(scan.scannedAt, t) })}
            {cached ? ` · ${t.workspace.cached}` : ''}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onRescan} className={btnSecondary}>
              {t.workspace.rescan}
            </button>
            <Link href={`/app/scans/${scan.id}`} className={btnPrimary}>
              {t.workspace.viewEvidence}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
