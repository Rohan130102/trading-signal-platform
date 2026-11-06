export interface PublicInfo {
  serviceName: string;
  serviceDescription: string;
  legalEntityName: string;
  regulatoryStatement: string;
  riskDisclosure: string;
  privacyNotice: string;
  supportContact: string;
  publicResultsAvailable: boolean;
}

const FALLBACK: PublicInfo = {
  serviceName: 'SignalDesk',
  serviceDescription: '',
  legalEntityName: '',
  regulatoryStatement: '',
  riskDisclosure: '',
  privacyNotice: '',
  supportContact: '',
  publicResultsAvailable: false,
};

/** A server-side read, so public pages still render if the API is briefly unavailable. */
export async function getPublicInfo(): Promise<PublicInfo> {
  const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${origin}/api/v1/public/info`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as PublicInfo) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
