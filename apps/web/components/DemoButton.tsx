'use client';

import { useState, useTransition } from 'react';
import { startDemo } from '../app/actions';
import { btnPrimary } from './ui';

export function DemoButton({ label, working, errorText }: { label: string; working: string; errorText: string }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={btnPrimary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startDemo();
            if (r && 'error' in r) setFailed(true);
          })
        }
      >
        {pending ? working : label}
      </button>
      {failed && <p className="mt-3 text-[14px] text-muted">{errorText}</p>}
    </div>
  );
}
