import { cookies } from 'next/headers';
import { Workspace } from '../../components/Workspace';
import { DICTS } from '../../lib/i18n';
import { requireOnboardedUser } from '../../lib/user';
import { CHECK_COOKIE, DEMO_COOKIE, demoModeFrom, pendingCheckUrl } from '../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const { lang, profile } = await requireOnboardedUser();
  const jar = await cookies();
  const demo = demoModeFrom(jar.get(DEMO_COOKIE)?.value);
  const initialCheck = pendingCheckUrl(jar.get(CHECK_COOKIE)?.value);
  // The sandbox client ID is public by design (PayPal JS SDK); the secret stays server-side.
  return <Workspace t={DICTS[lang]} lang={lang} clientId={process.env.PAYPAL_CLIENT_ID ?? ''} initialDemoMode={demo} autopay={profile.autopayEnabled} initialCheck={initialCheck} />;
}
