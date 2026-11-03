'use client';

import { useEffect, useState } from 'react';
import { formatWhen, type WhenStyle } from '../lib/when';

/** UTC (labelled) in the server's HTML, then the viewer's own time zone once the page runs in their browser. */
export function LocalTime({ at, lang, style = 'medium' }: { at: string; lang: string; style?: WhenStyle }) {
  const [text, setText] = useState(() => formatWhen(at, lang, style, 'UTC'));
  useEffect(() => setText(formatWhen(at, lang, style)), [at, lang, style]);
  return (
    <time dateTime={at} suppressHydrationWarning>
      {text}
    </time>
  );
}
