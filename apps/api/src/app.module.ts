import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdminController } from './admin/admin.controller.js';
import { AnnouncementsController } from './announcements/announcements.controller.js';
import { AnnouncementsService } from './announcements/announcements.service.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { RateLimitService } from './auth/rate-limit.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { AllExceptionsFilter } from './common/http.js';
import { ListenerService } from './db/listener.service.js';
import { DevicesController } from './devices/devices.controller.js';
import { DevicesService } from './devices/devices.service.js';
import { FeedController } from './feed/feed.controller.js';
import { FeedService } from './feed/feed.service.js';
import { PrismaService } from './db/prisma.service.js';
import { HealthController } from './health/health.controller.js';
import { InstrumentsController } from './instruments/instruments.controller.js';
import { MeController } from './me/me.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PushTransport } from './notifications/push-transport.js';
import { WorkerService } from './notifications/worker.service.js';
import { PerformanceService } from './performance/performance.service.js';
import { PublicController } from './public/public.controller.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { SettingsService } from './settings/settings.service.js';
import { SubscribersController } from './subscribers/subscribers.controller.js';
import { SubscribersService } from './subscribers/subscribers.service.js';
import { TemplatesController } from './templates/templates.controller.js';
import { TemplatesService } from './templates/templates.service.js';
import { TradeArchiveController } from './trades/archive.controller.js';
import { TradeArchiveService } from './trades/archive.service.js';
import { EventStore } from './trades/event-store.js';
import { TradesQueries } from './trades/trades.queries.js';
import { AdminTradesController, SubscriberTradesController } from './trades/trades.controller.js';
import { TradesService } from './trades/trades.service.js';

export const CONTROLLERS = [
  AuthController,
  MeController,
  FeedController,
  SubscriberTradesController,
  AdminTradesController,
  TradeArchiveController,
  AnnouncementsController,
  DevicesController,
  InstrumentsController,
  TemplatesController,
  SubscribersController,
  NotificationsController,
  AdminController,
  PublicController,
  HealthController,
];

const SERVICES = [
  PrismaService,
  ListenerService,
  AuditService,
  SettingsService,
  RateLimitService,
  DevicesService,
  AuthService,
  EventStore,
  AnnouncementsService,
  FeedService,
  TradeArchiveService,
  TemplatesService,
  TradesService,
  TradesQueries,
  SubscribersService,
  PushTransport,
  NotificationsService,
  PerformanceService,
  RealtimeGateway,
  WorkerService,
];

@Module({
  controllers: CONTROLLERS,
  providers: [
    ...SERVICES,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}

/** Everything the standalone worker needs and nothing that serves HTTP. */
@Module({ providers: SERVICES })
export class WorkerModule {}
