import type { Metadata } from 'next';
import { PublicFooter, PublicHeader } from '@/components/shell/public-header';
import { getPublicInfo } from '@/lib/public-info';

export const metadata: Metadata = { title: 'Risk disclosure and privacy' };

export default async function DisclosuresPage() {
  const info = await getPublicInfo();
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader name={info.serviceName} signupAvailable={info.signupAvailable} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 sm:px-6">
        <h1 className="text-[28px] font-semibold tracking-tight">Risk disclosure and privacy</h1>
        <section className="mt-6">
          <h2 className="font-semibold">Risk disclosure</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
            {info.riskDisclosure || 'Not available right now. Please try again shortly.'}
          </p>
        </section>
        {info.regulatoryStatement && (
          <section className="mt-6">
            <h2 className="font-semibold">Regulatory information</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{info.regulatoryStatement}</p>
          </section>
        )}
        <section className="mt-6">
          <h2 className="font-semibold">Privacy</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
            {info.privacyNotice || 'Not available right now. Please try again shortly.'}
          </p>
        </section>
      </main>
      <PublicFooter
        legalEntityName={info.legalEntityName}
        supportContact={info.supportContact}
        results={info.publicResultsAvailable}
      />
    </div>
  );
}
