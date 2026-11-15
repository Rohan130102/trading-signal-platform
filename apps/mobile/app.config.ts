import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Three builds from one configuration. The identifiers below are placeholders until the owner registers
 * real ones with Apple and Google: set APP_BUNDLE_ID in the build environment. See docs/MOBILE.md.
 */
const variant = process.env.APP_VARIANT ?? 'development';
const isProduction = variant === 'production';
const isDevelopment = variant === 'development';
const suffix = isProduction ? '' : isDevelopment ? '.dev' : '.preview';
const name = isProduction ? 'SignalDesk' : isDevelopment ? 'SignalDesk Dev' : 'SignalDesk Preview';
const identifier = `${process.env.APP_BUNDLE_ID ?? 'com.signaldesk.app'}${suffix}`;
const background = '#0B0D10';

/**
 * Over-the-air updates come from the build's own server, signed with the key whose certificate is in
 * code-signing/. A development build talks to Metro instead, and a build without an HTTPS server has none.
 */
const apiOrigin = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
const updatesUrl =
  !isDevelopment && apiOrigin.startsWith('https://') ? `${apiOrigin}/api/v1/app-updates/manifest` : null;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'signaldesk',
  scheme: isProduction ? 'signaldesk' : `signaldesk-${variant}`,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: background,
  // Changes whenever native code or configuration changes, so an update only reaches APKs that can run it.
  runtimeVersion: { policy: 'fingerprint' },
  updates: updatesUrl
    ? {
        url: updatesUrl,
        enabled: true,
        // Checked at launch without delaying it; a new version takes over at the next start (or the app offers it).
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
        codeSigningCertificate: './code-signing/certificate.pem',
        codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
      }
    : { enabled: false },
  ios: {
    bundleIdentifier: identifier,
    supportsTablet: false,
    // Lets actionable trade alerts (a new signal, a stop-loss move, a close) through a Focus the person allows.
    // Not critical alerts: nothing here overrides silent mode or Do Not Disturb.
    entitlements: { 'com.apple.developer.usernotifications.time-sensitive': true },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // Local network access exists only so a development build can reach a server on this computer.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: isDevelopment },
    },
  },
  android: {
    package: identifier,
    softwareKeyboardLayoutMode: 'resize',
    // Sessions must not come back from a device backup.
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-mono.png',
      backgroundColor: background,
    },
    permissions: ['android.permission.POST_NOTIFICATIONS'],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_PHONE_STATE',
    ],
    ...(process.env.GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE } : {}),
  },
  plugins: [
    'expo-router',
    // Nothing here uses biometrics, so the app should not declare that it might.
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 180, backgroundColor: background }],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#5AA9FF',
        mode: isProduction ? 'production' : 'development',
      },
    ],
    // Cleartext is for a development build talking to this computer. Every other build must use HTTPS.
    ['expo-build-properties', { android: { usesCleartextTraffic: isDevelopment } }],
  ],
  experiments: { tsconfigPaths: true },
  extra: {
    variant,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
    // Android receives pushes only when Firebase is compiled in; the app checks this before asking.
    androidPush: Boolean(process.env.GOOGLE_SERVICES_FILE),
  },
});
