'use client';

import dynamic from 'next/dynamic';
import type { Dict, Lang } from '../lib/i18n';
import type { RiskRow } from '../lib/risk-log-map';

/** AG Grid + AG Charts load only here, in the browser, so no other page's bundle grows. */
const RiskLog = dynamic(() => import('./RiskLog'), {
  ssr: false,
  loading: () => <p className="mt-6 text-[15px] text-muted">…</p>,
});

export function RiskLogLazy(props: { rows: RiskRow[]; stopped: Record<string, number>; t: Dict; lang: Lang }) {
  return <RiskLog {...props} />;
}
