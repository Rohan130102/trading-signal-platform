import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import { ErrorState, Loading, Screen, T } from '@/ui';

interface PublicInfo {
  legalEntityName: string;
  regulatoryStatement: string;
  riskDisclosure: string;
  privacyNotice: string;
  supportContact: string;
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <T v="heading" accessibilityRole="header">
        {title}
      </T>
      <T c="muted">{children}</T>
    </View>
  );
}

export default function Disclosures() {
  const info = useQuery({ queryKey: ['public-info'], queryFn: () => api.get<PublicInfo>('/public/info') });
  return (
    <Screen edges={['bottom']} style={{ gap: space.xl }} testID="disclosures">
      {info.isPending && <Loading rows={3} label="Loading" />}
      {info.isError && <ErrorState error={info.error} onRetry={() => void info.refetch()} />}
      {info.data && (
        <>
          <Section title="Risk disclosure">{info.data.riskDisclosure || 'Not available right now.'}</Section>
          {info.data.regulatoryStatement ? (
            <Section title="Regulatory information">{info.data.regulatoryStatement}</Section>
          ) : null}
          <Section title="Privacy">{info.data.privacyNotice || 'Not available right now.'}</Section>
          {info.data.legalEntityName ? <Section title="Provided by">{info.data.legalEntityName}</Section> : null}
          {info.data.supportContact ? <Section title="Contact">{info.data.supportContact}</Section> : null}
        </>
      )}
    </Screen>
  );
}
