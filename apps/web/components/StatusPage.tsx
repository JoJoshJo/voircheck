import Link from 'next/link';
import type { MascotMood } from './Mascot';
import { Mascot } from './Mascot';
import { btnPrimary } from './ui';

/** Not-found and error pages (Mono ink): the ghost, one line, and the way back. No hooks, so both can use it. */
export function StatusPage({ mood, code, title, body, home, children }: { mood: MascotMood; code?: string; title: string; body: string; home: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-6 pb-24 pt-24 text-center">
      <Mascot mood={mood} size={96} title="" />
      {code && <p className="mt-8 text-[13px] font-medium tracking-widest text-muted">{code}</p>}
      <h1 className={`${code ? 'mt-2' : 'mt-8'} text-[32px] font-medium leading-tight tracking-tight`}>{title}</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-muted">{body}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {children}
        <Link href="/" className={btnPrimary}>
          {home}
        </Link>
      </div>
    </main>
  );
}
