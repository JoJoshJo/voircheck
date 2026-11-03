// Makes icons/ghost-{16,32,48,128}.png from the web app's ghost mark (apps/web/app/icon.svg). Run once after changing
// the mark: `pnpm --filter @voircheck/extension icons`. The PNGs are committed; nothing renders them at runtime.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const mark = readFileSync(join(here, '../../web/app/icon.svg'), 'utf8');
// At 16 px the 2.4-unit strokes fade to sub-pixel lines: thicken them so the ghost still reads in the toolbar.
const small = mark.replaceAll('stroke-width="2.4"', 'stroke-width="3.6"').replace('stroke-width="3"', 'stroke-width="5"').replaceAll('r="2.2"', 'r="2.9"');

for (const size of [16, 32, 48, 128]) {
  const svg = size <= 16 ? small : mark;
  await sharp(Buffer.from(svg), { density: (72 * size) / 64 })
    .resize(size, size)
    .png()
    .toFile(join(here, `../icons/ghost-${size}.png`));
}
console.log('icons written');
