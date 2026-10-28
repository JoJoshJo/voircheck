import { PageTitle } from '../../../../components/catalog';
import { loadStore } from '../../../../lib/store';

export const metadata = { title: 'About & contact' };

export default async function AboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { store } = await loadStore((await params).slug);
  const { contact } = store;
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <section>
        <PageTitle>About {store.name}</PageTitle>
        <div className="space-y-4 text-[var(--muted)]">
          {store.about.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </section>
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="mb-4 text-xl font-semibold" style={{ fontFamily: 'var(--heading-font)' }}>
          Contact us
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-[var(--muted)]">Email</dt>
          <dd>{contact.email}</dd>
          {contact.phone && (
            <>
              <dt className="text-[var(--muted)]">Phone</dt>
              <dd>{contact.phone}</dd>
            </>
          )}
          {contact.address && (
            <>
              <dt className="text-[var(--muted)]">Address</dt>
              <dd>{contact.address}</dd>
            </>
          )}
          {contact.hours && (
            <>
              <dt className="text-[var(--muted)]">Hours</dt>
              <dd>{contact.hours}</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
