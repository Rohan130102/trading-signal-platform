import 'reflect-metadata';
import { DEFAULT_ANNOUNCEMENT_TEMPLATES, DEFAULT_TEMPLATES } from '@signaldesk/domain';
import { createAdapter } from '../db/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** Reference data only: instruments, templates and neutral settings. Never trades or testimonials. */
const prisma = new PrismaClient({ adapter: createAdapter(2) });

const INSTRUMENTS = [
  {
    symbol: 'XAU/USD',
    displayName: 'Gold / US Dollar',
    assetClass: 'COMMODITY',
    quoteCurrency: 'USD',
    pricePrecision: 2,
    tickSize: '0.01',
    pointSize: '1',
    defaultTargetPoints: '150',
    defaultStopPoints: '180',
    contractMultiplier: '1',
    unitLabel: 'oz',
    sortOrder: 10,
  },
  {
    symbol: 'BTC/USD',
    displayName: 'Bitcoin / US Dollar',
    assetClass: 'CRYPTO',
    quoteCurrency: 'USD',
    pricePrecision: 2,
    tickSize: '0.01',
    pointSize: '1',
    defaultTargetPoints: '150',
    defaultStopPoints: '180',
    contractMultiplier: '1',
    unitLabel: 'BTC',
    sortOrder: 20,
  },
];

const RISK_DISCLOSURE = `Trading involves substantial risk of loss and is not suitable for everyone. You can lose some or all of your capital.

Signals are general information and are not personal advice. They do not take your circumstances into account. You alone decide whether to act on them, and this service does not place trades for you.

Prices can move before you read a message. Notifications can be delayed or may not arrive, so check the app itself for the current state of a trade.

Past results do not indicate future results. Nothing here is a promise of accuracy, profit or safety.`;

const PRIVACY_NOTICE = `We collect only what we need to run your account: your name, contact details you give us, login activity and your notification settings. We use it to provide the service and to keep it secure. We do not sell it.

Contact support to ask about, correct or remove your information, subject to any record-keeping that the law requires.`;

async function main(): Promise<void> {
  for (const instrument of INSTRUMENTS) {
    await prisma.instrument.upsert({ where: { symbol: instrument.symbol }, create: instrument, update: {} });
  }
  for (const template of DEFAULT_TEMPLATES) {
    await prisma.signalTemplate.upsert({
      where: { kind_name: { kind: template.kind, name: template.name } },
      create: { ...template, isDefault: true },
      update: {},
    });
  }
  for (const template of DEFAULT_ANNOUNCEMENT_TEMPLATES) {
    await prisma.announcementTemplate.upsert({ where: { name: template.name }, create: template, update: {} });
  }
  await prisma.appSettings.update({
    where: { id: 1 },
    data: {
      riskDisclosure: RISK_DISCLOSURE,
      privacyNotice: PRIVACY_NOTICE,
      serviceDescription:
        'Structured trade ideas with clear entries, targets and stop-losses, with later changes shown against the trade they belong to. This service communicates signals only. It does not place trades.',
      regulatoryStatement: '',
      renewalInstructions: 'Contact support to renew. Your access returns as soon as the renewal is recorded.',
    },
  });
  console.warn('Seed complete: instruments, templates, announcement templates and settings are in place.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
