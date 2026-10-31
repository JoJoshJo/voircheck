import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../lib/i18n';
import { CollectedEvidence } from './CollectedEvidence';

const collected = {
  pages: [
    { url: 'https://shop.test/', kind: 'home' as const, title: 'Shop' },
    { url: 'https://shop.test/impressum', kind: 'legal' as const, title: '<script>alert(1)</script>' },
  ],
  facts: {
    companyNames: ['<img src=x onerror=alert(1)> GmbH'],
    addresses: [],
    phones: ['+49 30 1234 5678'],
    emails: [{ address: 'shop.service@gmail.com', freeMail: true, matchesStoreDomain: false }],
    freeMailContact: true,
    registrationIds: [{ type: 'VAT', value: 'DE123456789' }],
    paymentMethods: ['PayPal'],
    returnPolicy: false,
    discountsPct: [70],
  },
};

describe('"Collected for page analysis" on the evidence page', () => {
  it.each(['en', 'fr'] as const)('lists pages and facts as plain text (%s)', (lang) => {
    const t = DICTS[lang].evidence;
    const html = renderToStaticMarkup(createElement(CollectedEvidence, { collected, t }));
    for (const part of [t.collectedTitle, t.kind_legal, '+49 30 1234 5678', `shop.service@gmail.com (${t.factFreeMail})`, 'VAT: DE123456789', '70%', t.notFound]) {
      expect(html).toContain(part);
    }
    // Store text is escaped, never markup, and store URLs are not links.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; GmbH');
    expect(html).not.toContain('<a ');
  });
});
