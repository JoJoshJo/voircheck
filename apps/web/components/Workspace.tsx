'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { fmt, type Dict } from '../lib/i18n';
import type { ScanEvent, ScanView } from '../lib/scan-view';
import { DEMO_COOKIE } from '../lib/workspace';
import { Mascot } from './Mascot';
import { SignalIcon, SIGNAL_ORDER, type SignalState } from './SignalIcon';
import { btnPrimary, btnSecondary, card, input } from './ui';
import { VERDICT_CLASSES, VerdictBadge } from './Verdict';

type ScanState =
  | { phase: 'idle' }
  | { phase: 'scanning'; url: string; signals: Partial<Record<string, SignalState>>; liveViewUrl: string | null }
  | { phase: 'done'; scan: ScanView; cached: boolean }
  | { phase: 'error'; code: string; url?: string };

export function timeAgo(iso: string, t: Dict, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t.workspace.justNow;
  if (mins < 60) return fmt(t.workspace.minutesAgo, { n: mins });
  return fmt(t.workspace.hoursAgo, { n: Math.floor(mins / 60) });
}

export function Workspace({ t, initialDemoMode }: { t: Dict; initialDemoMode: boolean }) {
  const [tab, setTab] = useState<'chat' | 'results'>('results');
  const [demoMode, setDemoMode] = useState(initialDemoMode);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    document.cookie = `${DEMO_COOKIE}=${demoMode ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
  }, [demoMode]);

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
            if (e.type === 'cached') return { phase: 'done', scan: e.scan, cached: true };
            if (e.type === 'done') return { phase: 'done', scan: e.scan, cached: false };
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* LEFT: chat */}
        <section className={`${card} flex min-h-[540px] flex-col p-6 ${tab === 'chat' ? '' : 'hidden lg:flex'}`} aria-label={t.workspace.chatTitle}>
          <h2 className="text-[17px] font-medium">{t.workspace.chatTitle}</h2>
          <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
            <Mascot mood="idle" size={72} />
            <p className="max-w-xs text-[15px] leading-relaxed text-muted">{t.workspace.chatPlaceholder}</p>
          </div>
          <div className="mt-4 rounded-control border border-line bg-surface px-4 py-3 text-[14px] text-faint" aria-disabled="true">
            …
          </div>
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

          {state.phase === 'idle' && <p className="px-1 text-[15px] text-muted">{t.workspace.empty}</p>}
          {state.phase === 'scanning' && <ScanningCard t={t} url={state.url} signals={state.signals} liveViewUrl={state.liveViewUrl} />}
          {state.phase === 'done' && <ResultCard t={t} scan={state.scan} cached={state.cached} onRescan={() => void run(state.scan.url, true)} />}
          {state.phase === 'error' && (
            <div className={`${card} p-5 text-[15px] text-muted`}>
              {state.code === 'rate' ? t.workspace.errorRate : state.code === 'url' ? t.workspace.errorUrl : t.workspace.errorGeneric}
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

function ResultCard({ t, scan, cached, onRescan }: { t: Dict; scan: ScanView; cached: boolean; onRescan: () => void }) {
  const signals = Object.fromEntries(scan.signals.map((s) => [s.id, s.status])) as Record<string, SignalState>;
  return (
    <div className={`${card} relative overflow-hidden`}>
      <div className={`flex items-center justify-between gap-4 px-5 py-5 ${VERDICT_CLASSES[scan.verdict]}`}>
        <div>
          <VerdictBadge verdict={scan.verdict} t={t} large />
          <p className="mt-3 text-[16px] font-medium">{t.verdict[`${scan.verdict}_line`]}</p>
          <p className="mt-1 text-[13px] opacity-80">
            {t.workspace.score}: {scan.score}/100
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
