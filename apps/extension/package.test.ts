import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_FILES } from './scripts/files.mjs';

const DIR = __dirname;
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { icons: Record<string, string>; action: { default_icon: Record<string, string>; default_popup: string } };

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('extension package', () => {
  it('has every icon at its real pixel size', () => {
    for (const icons of [manifest.icons, manifest.action.default_icon]) {
      for (const [size, file] of Object.entries(icons)) expect(pngSize(join(DIR, file)), file).toEqual([Number(size), Number(size)]);
    }
    expect(Object.keys(manifest.icons)).toEqual(['16', '32', '48', '128']);
  });

  it('ships every file the manifest and popup load, and nothing else', () => {
    const html = readFileSync(join(DIR, manifest.action.default_popup), 'utf8');
    const loaded = [
      'manifest.json',
      manifest.action.default_popup,
      ...Object.values(manifest.icons),
      ...[...html.matchAll(/(?:src|href)="(?!https:)([^"]+)"/g)].map((m) => m[1]!),
      ...[...readFileSync(join(DIR, 'popup.js'), 'utf8').matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]!),
      '_locales/en/messages.json',
      '_locales/fr/messages.json',
    ];
    expect([...new Set(loaded)].sort()).toEqual([...PACKAGE_FILES].sort());
    for (const f of PACKAGE_FILES) expect(existsSync(join(DIR, f)), f).toBe(true);
  });
});
