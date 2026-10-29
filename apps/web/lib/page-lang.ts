import 'server-only';
import { isLang, type Lang } from './i18n';
import { getCurrentUser, getProfile, guessLang } from './user';

/** Language for public pages: ?lang=, else the signed-in user's setting, else cookie / browser. */
export async function publicPageLang(query?: string): Promise<{ lang: Lang; signedIn: boolean }> {
  const user = await getCurrentUser();
  if (isLang(query)) return { lang: query, signedIn: !!user };
  const profile = user ? await getProfile(user.id) : null;
  return { lang: profile && isLang(profile.language) ? profile.language : await guessLang(), signedIn: !!user };
}
