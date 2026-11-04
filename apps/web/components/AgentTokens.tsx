'use client';

import { useActionState, useState } from 'react';
import type { AgentTokenState } from '../app/app/settings/actions';
import { btnPrimary, btnSecondary, input, label } from './ui';

export interface AgentTokensText {
  title: string;
  body: string;
  endpoint: string;
  name: string;
  namePlaceholder: string;
  create: string;
  shownOnce: string;
  copy: string;
  copied: string;
  limit: string;
  unavailable: string;
  /** Shown instead of the form to guest ("Try the demo") accounts, which can't create tokens. */
  guest: string;
  none: string;
  created: string;
  lastUsed: string;
  never: string;
  revoke: string;
  docs: string;
}

/**
 * "Connect an AI agent" (Settings): create an MCP token (shown once, here, never again) and revoke existing ones.
 * Dates arrive pre-formatted from the server; the token list holds names and prefixes only, never a token or a hash.
 */
export function AgentTokens(props: {
  t: AgentTokensText;
  endpoint: string;
  /** Guest ("Try the demo") account: no form and no list, just why. */
  guest?: boolean;
  /** null: tokens aren't set up on this server yet (database migration pending). */
  tokens: Array<{ id: string; name: string; prefix: string; created: string; lastUsed: string | null }> | null;
  createAction: (prev: AgentTokenState, form: FormData) => Promise<AgentTokenState>;
  revokeAction: (form: FormData) => Promise<void>;
}) {
  const { t } = props;
  const [state, formAction, pending] = useActionState(props.createAction, null);
  const [copied, setCopied] = useState(false);
  const token = state && 'token' in state ? state.token : null;

  if (props.guest) {
    return (
      <div className="space-y-4">
        <h2 className="text-[15px] font-medium">{t.title}</h2>
        <p className="text-[15px] leading-relaxed text-muted">{t.body}</p>
        <p className="text-[15px]" data-testid="agent-guest">
          {t.guest}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[15px] font-medium">{t.title}</h2>
      <p className="text-[15px] leading-relaxed text-muted">{t.body}</p>
      <div>
        <p className={label}>{t.endpoint}</p>
        <code className="block break-all rounded-control bg-surface px-3 py-2 text-[13px]">{props.endpoint}</code>
      </div>
      {token && (
        <div className="space-y-2 rounded-control border border-ink p-3">
          <p className="text-[14px] font-medium">{t.shownOnce}</p>
          <code className="block break-all text-[13px]" data-testid="new-token">
            {token}
          </code>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              void navigator.clipboard?.writeText(token).then(() => setCopied(true));
            }}
          >
            {copied ? t.copied : t.copy}
          </button>
        </div>
      )}
      {state && 'error' in state && <p className="text-[14px] text-muted">{state.error === 'limit' ? t.limit : state.error === 'guest' ? t.guest : t.unavailable}</p>}
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="token-name" className={label}>
            {t.name}
          </label>
          <input id="token-name" name="name" maxLength={60} placeholder={t.namePlaceholder} className={input} />
        </div>
        <button className={btnPrimary} disabled={pending}>
          {t.create}
        </button>
      </form>
      {props.tokens === null ? (
        <p className="text-[14px] text-faint">{t.unavailable}</p>
      ) : props.tokens.length === 0 ? (
        <p className="text-[14px] text-faint">{t.none}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {props.tokens.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[15px]">{k.name}</p>
                <p className="text-[13px] text-faint">
                  <code>{k.prefix}…</code> · {t.created} {k.created} · {t.lastUsed} {k.lastUsed ?? t.never}
                </p>
              </div>
              <form action={props.revokeAction}>
                <input type="hidden" name="id" value={k.id} />
                <button className={btnSecondary}>{t.revoke}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] text-faint">{t.docs}</p>
    </div>
  );
}
