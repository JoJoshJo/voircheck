import { APP_ORIGIN, checkLink, hostOf, savedVerdictUrl } from './link.js';

/**
 * The toolbar popup (spec 5.23). activeTab lets it read the current tab's link after the click; "Check this store"
 * opens VoirCheck's /check with that link and closes. Its one network call (Nov 11): it asks voircheck.com for a saved
 * result about the tab's DOMAIN only (no path, no page content, no cookies) and shows it if there is one.
 */
const t = (/** @type {string} */ key) => chrome.i18n.getMessage(key);
const lang = chrome.i18n.getUILanguage().startsWith('fr') ? 'fr' : 'en';

document.documentElement.lang = lang;
for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n]'))) {
  el.textContent = t(el.dataset.i18n ?? '');
}

const host = /** @type {HTMLElement} */ (document.getElementById('host'));
const button = /** @type {HTMLButtonElement} */ (document.getElementById('check'));
const note = /** @type {HTMLElement} */ (document.getElementById('note'));
const how = /** @type {HTMLAnchorElement} */ (document.getElementById('how'));
const saved = /** @type {HTMLElement} */ (document.getElementById('saved'));
const savedVerdict = /** @type {HTMLElement} */ (document.getElementById('saved-verdict'));
const savedMessage = /** @type {HTMLElement} */ (document.getElementById('saved-message'));
const savedDate = /** @type {HTMLElement} */ (document.getElementById('saved-date'));

/** @param {string} url */
async function open(url) {
  await chrome.tabs.create({ url });
  window.close();
}

how.addEventListener('click', (e) => {
  e.preventDefault();
  void open(`${APP_ORIGIN}/how-it-works`);
});

const VERDICTS = ['SAFE', 'HOLD', 'BLOCK'];

/**
 * The saved result, checked field by field (the answer is data, shown as text only), or null for "Not checked yet".
 * Throws when the lookup itself fails.
 * @param {string} domain
 * @returns {Promise<{ verdict: string, message: string, checkedAt: Date } | null>}
 */
async function lookUp(domain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(savedVerdictUrl(domain), { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (body?.status !== 'checked') return null;
    const message = body.message?.[lang];
    const checkedAt = new Date(body.checkedAt);
    if (!VERDICTS.includes(body.verdict) || typeof message !== 'string' || Number.isNaN(checkedAt.getTime())) return null;
    return { verdict: body.verdict, message: message.slice(0, 300), checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} domain */
async function showSaved(domain) {
  saved.hidden = false;
  savedVerdict.textContent = t('savedLoading');
  try {
    const found = await lookUp(domain);
    if (!found) {
      savedVerdict.textContent = t('savedNone');
      return;
    }
    savedVerdict.textContent = t(`verdict${found.verdict}`);
    savedMessage.textContent = found.message;
    const day = found.checkedAt.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    savedDate.textContent = `${t('savedCheckedOn')} ${day}`;
  } catch {
    savedVerdict.textContent = t('savedNone');
    savedMessage.textContent = t('savedUnavailable');
  }
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const link = checkLink(tab?.url);
if (link && tab?.url) {
  const domain = hostOf(tab.url);
  host.textContent = domain;
  note.textContent = t('checkNote');
  button.disabled = false;
  button.addEventListener('click', () => void open(link));
  button.focus();
  void showSaved(domain);
} else {
  host.textContent = '—';
  note.textContent = t('notAStore');
}
