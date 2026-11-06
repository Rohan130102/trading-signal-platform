import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { THEME_SCRIPT } from '@/lib/theme';
import { Providers } from '@/components/providers';
import './globals.css';

// Every page needs a per-request CSP nonce, so nothing here can be statically prerendered.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'SignalDesk', template: '%s · SignalDesk' },
  description:
    'Structured trading signals and every update to them. This service communicates signals only and does not place trades.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'SignalDesk', statusBarStyle: 'black-translucent' },
  icons: { apple: '/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0b0d10',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
