import type { LegalPage } from '../lib/legal';

/** Privacy / Terms layout: readable width, Mono ink, plain text only. */
export function LegalPageView({ page, lang }: { page: LegalPage; lang: string }) {
  return (
    <main lang={lang} className="mx-auto max-w-2xl px-6 pb-20 pt-10">
      <h1 className="text-[36px] font-medium leading-tight tracking-tight">{page.title}</h1>
      <p className="mt-2 text-[13px] text-faint">{page.lastUpdated}</p>
      <div className="mt-8 space-y-4 text-[16px] leading-relaxed">
        {page.intro.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      {page.sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="text-[20px] font-medium tracking-tight">{section.heading}</h2>
          {section.paragraphs?.map((p) => (
            <p key={p} className="mt-3 text-[15px] leading-relaxed text-muted">
              {p}
            </p>
          ))}
          {section.items && (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted marker:text-faint">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
