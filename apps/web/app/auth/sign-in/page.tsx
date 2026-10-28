import { AuthForm } from '../../../components/AuthForm';
import { SiteHeader } from '../../../components/SiteHeader';
import { dictFor, guessLang } from '../../../lib/user';
import { signInWithEmail } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const t = dictFor(await guessLang());
  return (
    <>
      <SiteHeader t={t} signedIn={false} />
      <main className="px-6 pb-24 pt-16">
        <AuthForm mode="sign-in" action={signInWithEmail} t={t} />
      </main>
    </>
  );
}
