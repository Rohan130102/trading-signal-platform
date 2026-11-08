import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { releaseDeviceSchema } from '@signaldesk/domain';
import type { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, RequestId, Summary, ZBody } from '../common/http.js';
import { DevicesService } from './devices.service.js';

@Controller('admin')
@AdminOnly()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get('subscribers/:id/devices')
  @Summary('App installations bound to a subscriber, current and released')
  async list(@Param('id', ParseUUIDPipe) id: string) {
    return { devices: await this.devices.forUser(id) };
  }

  @Post('devices/:id/release')
  @HttpCode(200)
  @Summary('Free an installation for another account. Signs the old account out of it.')
  release(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(releaseDeviceSchema) body: z.infer<typeof releaseDeviceSchema>,
  ) {
    return this.devices.release(id, auth.user.id, body.reason, requestId);
  }
}
