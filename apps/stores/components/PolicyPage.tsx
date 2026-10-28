import { PageTitle } from './catalog';

/** A missing policy (null) renders as a placeholder page, which is itself a broken-policy tell. */
export function PolicyPage({ title, paragraphs }: { title: string; paragraphs: string[] | null }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle>{title}</PageTitle>
      {paragraphs ? (
        <div className="space-y-4 text-[var(--muted)]">
          {paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      ) : (
        <p className="text-[var(--muted)]">This page is being updated. Please check back soon.</p>
      )}
    </div>
  );
}
