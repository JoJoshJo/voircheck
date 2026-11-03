import { APP_ORIGIN, checkLink, hostOf } from './link.js';

/**
 * The toolbar popup (spec 5.23). activeTab lets it read the current tab's link after the click; "Check this store"
 * opens VoirCheck's /check with that link and closes. No network calls, no page content, no payment data.
 */
const t = (/** @type {string} */ key) => chrome.i18n.getMessage(key);

document.documentElement.lang = chrome.i18n.getUILanguage().startsWith('fr') ? 'fr' : 'en';
for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n]'))) {
  el.textContent = t(el.dataset.i18n ?? '');
}

const host = /** @type {HTMLElement} */ (document.getElementById('host'));
const button = /** @type {HTMLButtonElement} */ (document.getElementById('check'));
const note = /** @type {HTMLElement} */ (document.getElementById('note'));
const how = /** @type {HTMLAnchorElement} */ (document.getElementById('how'));

/** @param {string} url */
async function open(url) {
  await chrome.tabs.create({ url });
  window.close();
}

how.addEventListener('click', (e) => {
  e.preventDefault();
  void open(`${APP_ORIGIN}/how-it-works`);
});

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const link = checkLink(tab?.url);
if (link && tab?.url) {
  host.textContent = hostOf(tab.url);
  note.textContent = t('checkNote');
  button.disabled = false;
  button.addEventListener('click', () => void open(link));
  button.focus();
} else {
  host.textContent = '—';
  note.textContent = t('notAStore');
}
