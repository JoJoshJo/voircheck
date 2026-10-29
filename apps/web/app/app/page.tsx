import { cookies } from 'next/headers';
import { Workspace } from '../../components/Workspace';
import { DICTS } from '../../lib/i18n';
import { requireOnboardedUser } from '../../lib/user';
import { DEMO_COOKIE, demoModeFrom } from '../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const { lang, profile } = await requireOnboardedUser();
  const demo = demoModeFrom((await cookies()).get(DEMO_COOKIE)?.value);
  // The sandbox client ID is public by design (PayPal JS SDK); the secret stays server-side.
  return <Workspace t={DICTS[lang]} lang={lang} clientId={process.env.PAYPAL_CLIENT_ID ?? ''} initialDemoMode={demo} autopay={profile.autopayEnabled} />;
}
