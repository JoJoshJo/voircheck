// Builds dist/voircheck-extension/ (load it unpacked) and dist/voircheck-extension-v<version>.zip from PACKAGE_FILES.
// `pnpm --filter @voircheck/extension zip`. Nothing is uploaded or published.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_FILES } from './files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const dist = join(root, 'dist');
const folder = join(dist, 'voircheck-extension');
const zip = join(dist, `voircheck-extension-v${version}.zip`);

rmSync(dist, { recursive: true, force: true });
for (const file of PACKAGE_FILES) {
  mkdirSync(dirname(join(folder, file)), { recursive: true });
  cpSync(join(root, file), join(folder, file));
}
// -X: no extra file attributes (owner, macOS metadata), so the zip holds just the files.
execFileSync('zip', ['-r', '-X', '-q', zip, 'voircheck-extension'], { cwd: dist });
console.log(zip);
