import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Everything the extension runs or renders (spec 5.23: check only, no remote code, no page reading).
const SHIPPED = ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'link.js'];
const files = SHIPPED.map((name) => ({ name, text: readFileSync(join(__dirname, name), 'utf8') }));

describe('extension source guard', () => {
  it('makes exactly one network call, the saved-result lookup, and runs no dynamic code', () => {
    for (const f of files) {
      expect(f.text, f.name).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|sendBeacon|\beval\(|new Function|import\(|setTimeout\(\s*['"`]/);
    }
    const fetches = files.flatMap((f) => [...f.text.matchAll(/\bfetch\(([^,]*),/g)].map((m) => `${f.name}: ${m[1]}`));
    expect(fetches).toEqual(['popup.js: savedVerdictUrl(domain)']);
    const popup = files.find((f) => f.name === 'popup.js')!.text;
    // No cookies, no referrer (which would carry the tab's full link), no caching.
    expect(popup).toMatch(/credentials: 'omit'/);
    expect(popup).toMatch(/referrerPolicy: 'no-referrer'/);
    // It only ever gets the domain: hostOf(tab.url), never the link itself.
    expect(popup).toMatch(/const domain = hostOf\(tab\.url\);/);
    expect(popup).toMatch(/showSaved\(domain\)/);
  });

  it('never writes HTML from strings', () => {
    for (const f of files) expect(f.text, f.name).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('has no inline scripts or event handlers in the popup', () => {
    const html = files.find((f) => f.name === 'popup.html')!.text;
    expect([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(['<script type="module" src="popup.js">']);
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it('only ever points at voircheck.com', () => {
    for (const f of files) {
      for (const [url] of f.text.matchAll(/(?:https?:)?\/\/[\w.-]+\.[a-z]{2,}/gi)) expect(url, f.name).toMatch(/^https:\/\/voircheck\.com$/);
    }
  });

  it('touches no other Chrome APIs than tabs.query, tabs.create and i18n', () => {
    const used = new Set(files.flatMap((f) => [...f.text.matchAll(/chrome\.(\w+\.\w+)/g)].map((m) => m[1])));
    expect([...used].sort()).toEqual(['i18n.getMessage', 'i18n.getUILanguage', 'tabs.create', 'tabs.query']);
  });
});
