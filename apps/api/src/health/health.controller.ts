import { Controller, Get } from '@nestjs/common';
import { AppError, Public, Summary } from '../common/http.js';
import { PrismaService } from '../db/prisma.service.js';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @Summary('The process is up')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Summary('The process can reach its database')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppError(503, 'NOT_READY', 'Database unavailable');
    }
    return { status: 'ok' };
  }
}
