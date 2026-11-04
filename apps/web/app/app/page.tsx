import { cookies } from 'next/headers';
import { Workspace } from '../../components/Workspace';
import { demoTryLinks } from '../../lib/demo-links';
import { DICTS } from '../../lib/i18n';
import { requireOnboardedUser } from '../../lib/user';
import { autoStartFor, CHECK_AUTO_COOKIE, CHECK_COOKIE, DEMO_COOKIE, demoModeFrom, pendingCheckUrl } from '../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const { lang, profile } = await requireOnboardedUser();
  const jar = await cookies();
  const demo = demoModeFrom(jar.get(DEMO_COOKIE)?.value);
  const initialCheck = pendingCheckUrl(jar.get(CHECK_COOKIE)?.value);
  // Start scanning on arrival only if /check marked this very link (see CHECK_AUTO_COOKIE).
  const autoStart = autoStartFor(initialCheck, jar.get(CHECK_AUTO_COOKIE)?.value);
  // The sandbox client ID is public by design (PayPal JS SDK); the secret stays server-side.
  return <Workspace t={DICTS[lang]} lang={lang} clientId={process.env.PAYPAL_CLIENT_ID ?? ''} initialDemoMode={demo} autopay={profile.autopayEnabled} initialCheck={initialCheck} autoStart={autoStart} demoLinks={demoTryLinks(process.env.DEMO_STORES_BASE_URL)} />;
}
