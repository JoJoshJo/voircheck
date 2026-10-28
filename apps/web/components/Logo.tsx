import Link from 'next/link';
import { Mascot } from './Mascot';

/** Wordmark in the system font, medium weight (spec 5.12). */
export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-[17px] font-medium tracking-tight text-ink">
      <Mascot size={26} title="" />
      VoirCheck
    </Link>
  );
}
