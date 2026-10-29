import { AuthForm } from '../../../components/AuthForm';
import { SiteHeader } from '../../../components/SiteHeader';
import { authErrorFromParams } from '../../../lib/oauth';
import { dictFor, guessLang } from '../../../lib/user';
import { signInWithEmail } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string | string[]; link?: string | string[] }> }) {
  const t = dictFor(await guessLang());
  // Google (?error=…) or an expired/used magic link (?link=expired) sends the browser back here.
  const authError = authErrorFromParams(await searchParams);
  return (
    <>
      <SiteHeader t={t} signedIn={false} />
      <main className="px-6 pb-24 pt-16">
        <AuthForm mode="sign-in" authError={authError} action={signInWithEmail} t={t} />
      </main>
    </>
  );
}
