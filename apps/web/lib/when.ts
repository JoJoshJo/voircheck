/**
 * Dates with a time, always with their time zone named. Server-rendered pages don't know the viewer's zone, so they
 * print UTC and say so; <LocalTime> then switches to the viewer's own zone in the browser. Emails stay in UTC.
 */
export type WhenStyle = 'medium' | 'long';

export function formatWhen(at: Date | string, lang: string, style: WhenStyle, timeZone?: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const date = new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone }).format(d);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(d);
  return lang === 'fr' ? `${date} à ${time}` : `${date}, ${time}`;
}

/** A "{when}" template around a node (the template text stays plain; only the time is a component). */
export function splitWhen(template: string): [string, string] {
  const i = template.indexOf('{when}');
  return i < 0 ? [template, ''] : [template.slice(0, i), template.slice(i + '{when}'.length)];
}
