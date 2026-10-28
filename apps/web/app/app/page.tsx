import { cookies } from 'next/headers';
import { Workspace } from '../../components/Workspace';
import { DICTS } from '../../lib/i18n';
import { requireOnboardedUser } from '../../lib/user';
import { DEMO_COOKIE, demoModeFrom } from '../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const { lang } = await requireOnboardedUser();
  const demo = demoModeFrom((await cookies()).get(DEMO_COOKIE)?.value);
  return <Workspace t={DICTS[lang]} initialDemoMode={demo} />;
}
