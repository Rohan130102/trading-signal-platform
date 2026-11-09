import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { adminStatusSchema, createAdminSchema, masterAdminSchema } from '@signaldesk/domain';
import type { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, MasterOnly, RequestId, Summary, ZBody } from '../common/http.js';
import { AdminsService } from './admins.service.js';

@Controller('admin/admins')
@AdminOnly()
@MasterOnly()
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  @Summary('Every administrator. Master Admin only.')
  async list(@Auth() auth: AuthContext) {
    return { admins: await this.admins.list(auth.user.id) };
  }

  @Post()
  @Summary('Register an administrator. The temporary password is shown once. Master Admin only.')
  create(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(createAdminSchema) body: z.infer<typeof createAdminSchema>,
  ) {
    return this.admins.create(body, { id: auth.user.id, requestId });
  }

  @Post(':id/status')
  @HttpCode(200)
  @Summary('Suspend, disable or reactivate an administrator. Suspending signs them out everywhere.')
  setStatus(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(adminStatusSchema) body: z.infer<typeof adminStatusSchema>,
  ) {
    return this.admins.setStatus(id, body, { id: auth.user.id, requestId });
  }

  @Post(':id/master')
  @HttpCode(200)
  @Summary('Grant or remove Master Admin. There is always at least one.')
  setMaster(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(masterAdminSchema) body: z.infer<typeof masterAdminSchema>,
  ) {
    return this.admins.setMaster(id, body, { id: auth.user.id, requestId });
  }

  @Post(':id/reset')
  @HttpCode(200)
  @Summary('New temporary password; two-step verification must be set up again; every session ends.')
  reset(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.admins.resetAccess(id, { id: auth.user.id, requestId });
  }
}
