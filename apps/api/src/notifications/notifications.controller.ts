import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  preferencesSchema,
  pushOpenedSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
  registerDeviceSchema,
  unregisterDeviceSchema,
} from '@signaldesk/domain';
import type { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, RequestId, RequireSignalAccess, Summary, ZBody } from '../common/http.js';
import { NotificationsService } from './notifications.service.js';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('push/opened')
  @HttpCode(200)
  @Summary('Record that a notification was opened on this device, and mark it read')
  opened(@Auth() auth: AuthContext, @ZBody(pushOpenedSchema) body: z.infer<typeof pushOpenedSchema>) {
    return this.notifications.markOpened(auth.user.id, auth.sessionId, body.eventId);
  }

  @Get('push/config')
  @Summary('Whether push is available on this deployment, and its public key')
  config() {
    return this.notifications.config();
  }

  @Get('push/devices')
  @Summary('Devices registered for your notifications')
  async devices(@Auth() auth: AuthContext) {
    return { devices: await this.notifications.devices(auth.user.id, auth.sessionId) };
  }

  @Post('push/subscriptions')
  @RequireSignalAccess()
  @Summary('Register this browser for push notifications')
  subscribe(@Auth() auth: AuthContext, @ZBody(pushSubscribeSchema) body: z.infer<typeof pushSubscribeSchema>) {
    return this.notifications.subscribe(auth.user.id, auth.sessionId, body);
  }

  @Delete('push/subscriptions')
  @HttpCode(200)
  @Summary('Stop push notifications to this browser')
  async unsubscribe(
    @Auth() auth: AuthContext,
    @ZBody(pushUnsubscribeSchema) body: z.infer<typeof pushUnsubscribeSchema>,
  ) {
    await this.notifications.unsubscribe(auth.user.id, body.endpoint);
    return { ok: true };
  }

  @Post('push/devices')
  @RequireSignalAccess()
  @Summary('Register this installed app for native notifications')
  registerDevice(@Auth() auth: AuthContext, @ZBody(registerDeviceSchema) body: z.infer<typeof registerDeviceSchema>) {
    return this.notifications.registerNativeDevice(auth.user.id, auth.sessionId, body);
  }

  @Delete('push/devices')
  @HttpCode(200)
  @Summary('Stop native notifications to this installed app')
  async unregisterDevice(
    @Auth() auth: AuthContext,
    @ZBody(unregisterDeviceSchema) body: z.infer<typeof unregisterDeviceSchema>,
  ) {
    await this.notifications.unregisterNativeDevice(auth.user.id, body.token);
    return { ok: true };
  }

  @Post('push/test')
  @HttpCode(200)
  @RequireSignalAccess()
  @Summary('Send a test notification to your own devices')
  test(@Auth() auth: AuthContext) {
    return this.notifications.sendTest(auth.user.id);
  }

  @Get('me/notification-preferences')
  @Summary('Your notification preferences')
  preferences(@Auth() auth: AuthContext) {
    return this.notifications.getPreferences(auth.user.id);
  }

  @Put('me/notification-preferences')
  @Summary('Update your notification preferences')
  setPreferences(@Auth() auth: AuthContext, @ZBody(preferencesSchema) body: z.infer<typeof preferencesSchema>) {
    return this.notifications.setPreferences(auth.user.id, body);
  }

  @Get('admin/notifications/health')
  @AdminOnly()
  @Summary('Worker, outbox, push and live-delivery health')
  health() {
    return this.notifications.health();
  }

  @Post('admin/notifications/retry-failed')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Requeue recent failed deliveries')
  retry(@Auth() auth: AuthContext, @RequestId() requestId: string) {
    return this.notifications.retryFailed(auth.user.id, requestId);
  }
}
