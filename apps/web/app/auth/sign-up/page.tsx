import { AuthForm } from '../../../components/AuthForm';
import { SiteHeader } from '../../../components/SiteHeader';
import { dictFor, guessLang } from '../../../lib/user';
import { signUpWithEmail } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const t = dictFor(await guessLang());
  // Google sends the browser back here with ?error=… when sign-in fails or is cancelled.
  const oauthError = !!(await searchParams).error;
  return (
    <>
      <SiteHeader t={t} signedIn={false} />
      <main className="px-6 pb-24 pt-16">
        <AuthForm mode="sign-up" oauthError={oauthError} action={signUpWithEmail} t={t} />
      </main>
    </>
  );
}
