import { StatusPage } from '../components/StatusPage';
import { DICTS } from '../lib/i18n';
import { guessLang } from '../lib/user';

export const metadata = { title: '404' };

/** Every notFound() and unknown URL, including another person's scan or payment (spec 5.10: same answer as missing). */
export default async function NotFound() {
  const t = DICTS[await guessLang()];
  return <StatusPage mood="HOLD" code="404" title={t.errors.notFoundTitle} body={t.errors.notFoundBody} home={t.errors.home} />;
}
