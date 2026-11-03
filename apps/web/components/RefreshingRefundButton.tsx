'use client';

import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { RefundButton } from './RefundButton';

/** RefundButton on a server-rendered page (History, the pay page): after a refund, reload the page's data. */
export function RefreshingRefundButton(props: Omit<ComponentProps<typeof RefundButton>, 'onStatus'>) {
  const router = useRouter();
  return <RefundButton {...props} onStatus={() => router.refresh()} />;
}
