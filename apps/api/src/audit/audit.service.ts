import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService, type Tx } from '../db/prisma.service.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Identifiers and before/after values only. Never credentials. */
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata ?? {},
        requestId: entry.requestId,
      },
    });
  }
}
