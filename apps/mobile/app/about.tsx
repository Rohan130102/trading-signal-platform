import { type PublicInfo, whatsappDigits } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { Linking, View } from 'react-native';
import { api } from '@/lib/api';
import { websiteUrl } from '@/lib/config';
import { space } from '@/theme/tokens';
import { Button, Card, ErrorState, Loading, Logo, Notice, Screen, T } from '@/ui';

/**
 * About us, in the app as on the website. The text is the one the Super Admin writes on the configuration screen.
 * Readable before signing in.
 */
export default function About() {
  const info = useQuery({ queryKey: ['public-info'], queryFn: () => api.get<PublicInfo>('/public/info') });
  const d = info.data;
  const digits = d ? whatsappDigits(d.supportWhatsapp) : null;
  const site = websiteUrl();
  return (
    <Screen edges={['bottom']} style={{ gap: space.xl }} testID="about">
      {info.isPending && <Loading rows={3} label="Loading" />}
      {info.isError && <ErrorState error={info.error} onRetry={() => void info.refetch()} />}
      {d && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Logo size={44} />
            <View style={{ flex: 1 }}>
              <T v="title" accessibilityRole="header">
                {d.serviceName}
              </T>
              {d.serviceDescription ? <T c="muted">{d.serviceDescription}</T> : null}
            </View>
          </View>
          <View style={{ gap: space.sm }}>
            <T v="heading" accessibilityRole="header">
              About us
            </T>
            <T c="muted">{d.aboutBody || 'More about us is coming soon.'}</T>
          </View>
          <Notice tone="neutral" icon="shield-checkmark-outline">
            Signals only: we never place trades for you, and a signal is never a promise of any result.
          </Notice>
          {(digits || d.supportEmail) && (
            <Card style={{ gap: space.md }}>
              <T v="strong">Talk to us</T>
              {digits ? (
                <Button
                  testID="about-whatsapp"
                  icon="logo-whatsapp"
                  label="Message us on WhatsApp"
                  onPress={() => void Linking.openURL(`https://wa.me/${digits}`)}
                />
              ) : null}
              {d.supportEmail ? (
                <Button
                  testID="about-email"
                  variant="ghost"
                  icon="mail-outline"
                  label={d.supportEmail}
                  onPress={() => void Linking.openURL(`mailto:${d.supportEmail}`)}
                />
              ) : null}
            </Card>
          )}
          {d.publicResultsAvailable && site ? (
            <Button
              testID="about-performance"
              variant="ghost"
              icon="open-outline"
              label="Performance record (opens in your browser)"
              onPress={() => void Linking.openURL(`${site}/about#performance`)}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
