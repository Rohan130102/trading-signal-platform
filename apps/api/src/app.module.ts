import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdminController } from './admin/admin.controller.js';
import { AdminsController } from './admins/admins.controller.js';
import { AdminsService } from './admins/admins.service.js';
import { AppUpdatesController } from './app-updates/app-updates.controller.js';
import { AppUpdatesService } from './app-updates/app-updates.service.js';
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
import { AudienceService } from './feed/audience.service.js';
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
import { RegistrationsAdminController, SubscribersController } from './subscribers/subscribers.controller.js';
import { EmailService } from './email/email.service.js';
import { EmailTransport } from './email/email-transport.js';
import { EnquiriesService } from './enquiries/enquiries.service.js';
import { NoticesService } from './notices/notices.service.js';
import { EmailChallengeService } from './registration/email-challenge.service.js';
import { PasswordResetsService } from './registration/password-resets.service.js';
import { RegistrationController } from './registration/registration.controller.js';
import { RegistrationService } from './registration/registration.service.js';
import { SubscribersService } from './subscribers/subscribers.service.js';
import { TemplatesController } from './templates/templates.controller.js';
import { TemplatesService } from './templates/templates.service.js';
import { TradeArchiveController } from './trades/archive.controller.js';
import { TradeArchiveService } from './trades/archive.service.js';
import { TradeRemovalController } from './trades/removal.controller.js';
import { TradeRemovalService } from './trades/removal.service.js';
import { EventStore } from './trades/event-store.js';
import { TradesQueries } from './trades/trades.queries.js';
import { AdminTradesController, SubscriberTradesController } from './trades/trades.controller.js';
import { TradesService } from './trades/trades.service.js';

export const CONTROLLERS = [
  AuthController,
  RegistrationController,
  MeController,
  FeedController,
  SubscriberTradesController,
  AdminTradesController,
  TradeArchiveController,
  TradeRemovalController,
  AdminsController,
  AnnouncementsController,
  DevicesController,
  InstrumentsController,
  TemplatesController,
  SubscribersController,
  RegistrationsAdminController,
  NotificationsController,
  AdminController,
  PublicController,
  AppUpdatesController,
  HealthController,
];

const SERVICES = [
  PrismaService,
  AppUpdatesService,
  ListenerService,
  AuditService,
  SettingsService,
  RateLimitService,
  DevicesService,
  AuthService,
  EventStore,
  AnnouncementsService,
  AudienceService,
  FeedService,
  TradeArchiveService,
  TradeRemovalService,
  AdminsService,
  TemplatesService,
  TradesService,
  TradesQueries,
  EmailTransport,
  EmailService,
  NoticesService,
  EmailChallengeService,
  RegistrationService,
  PasswordResetsService,
  EnquiriesService,
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
