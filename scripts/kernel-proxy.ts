/**
 * Create (or reuse) the KERNEL ISP proxy the scanner routes through, and print its id for KERNEL_PROXY_ID.
 *   pnpm kernel:proxy [--country DE|GB|FR|US|SG]
 * The scanner uses it with a NON-stealth browser: stealth mode always loads KERNEL's automatic CAPTCHA solver, and
 * a safety scanner must never defeat a site's CAPTCHA. Kernel-provided proxies are unmetered (KERNEL docs, Oct 2026).
 */
import 'dotenv/config';
import { ensureIspProxy, ISP_PROXY_COUNTRIES } from '@voircheck/scanner';

const args = process.argv.slice(2);
const country = (args.includes('--country') ? args[args.indexOf('--country') + 1] : 'DE')!.toUpperCase() as (typeof ISP_PROXY_COUNTRIES)[number];
if (!ISP_PROXY_COUNTRIES.includes(country)) {
  console.error(`usage: pnpm kernel:proxy [--country ${ISP_PROXY_COUNTRIES.join('|')}]`);
  process.exit(2);
}
const apiKey = process.env.KERNEL_API_KEY;
if (!apiKey) {
  console.error('KERNEL_API_KEY missing in .env');
  process.exit(1);
}
const { id, name, created } = await ensureIspProxy(apiKey, country);
console.log(`${created ? 'Created' : 'Reusing'} ${name}. Add to .env: KERNEL_PROXY_ID=${id}`);
