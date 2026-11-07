import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = __dirname;
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Record<string, unknown>;
const messages = (lang: string) => JSON.parse(readFileSync(join(DIR, '_locales', lang, 'messages.json'), 'utf8')) as Record<string, { message: string }>;

describe('extension manifest', () => {
  it('is MV3 with activeTab as its only permission', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['activeTab']);
  });

  it('asks for no hosts, runs nothing on pages and exposes nothing', () => {
    for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'background', 'web_accessible_resources', 'externally_connectable', 'update_url', 'key']) {
      expect(manifest, key).not.toHaveProperty(key);
    }
  });

  it('has a strict CSP for its own pages', () => {
    expect(manifest.content_security_policy).toEqual({ extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" });
  });

  it('opens the popup from the toolbar and is translated', () => {
    expect((manifest.action as { default_popup: string }).default_popup).toBe('popup.html');
    expect(manifest.default_locale).toBe('en');
    for (const field of [manifest.name, manifest.description, (manifest.action as { default_title: string }).default_title]) {
      const key = /^__MSG_(\w+)__$/.exec(String(field))?.[1];
      expect(key, String(field)).toBeDefined();
      expect(messages('en')[key!]).toBeDefined();
    }
  });
});

describe('extension locales', () => {
  const en = messages('en');
  const fr = messages('fr');

  it('EN and FR have the same keys, none empty', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const m of [...Object.values(en), ...Object.values(fr)]) expect(m.message.trim()).not.toBe('');
  });

  it('every data-i18n key in the popup exists', () => {
    const html = readFileSync(join(DIR, 'popup.html'), 'utf8');
    const js = readFileSync(join(DIR, 'popup.js'), 'utf8');
    const keys = [...html.matchAll(/data-i18n="(\w+)"/g), ...js.matchAll(/\bt\('(\w+)'\)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(4);
    for (const k of keys) expect(en, k).toHaveProperty(k);
  });

  it('descriptions fit Chrome’s 132-character limit', () => {
    expect(en.extDescription!.message.length).toBeLessThanOrEqual(132);
    expect(fr.extDescription!.message.length).toBeLessThanOrEqual(132);
  });

  it('the popup note uses the plain verdict words, not the old Safe/Hold/Block labels', () => {
    expect(en.checkNote!.message).toContain('looks safe, a bit off, or looks fake');
    expect(en.checkNote!.message).not.toMatch(/Safe, Hold or Block/);
    expect(fr.checkNote!.message).toContain('semble fiable, un doute, ou semble faux');
    expect(fr.checkNote!.message).not.toMatch(/Fiable, En attente ou Bloquée/);
  });
});
