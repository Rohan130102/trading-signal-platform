import { Injectable } from '@nestjs/common';
import type { EventPayload, EventType, Priority } from '@signaldesk/domain';
import { CH_EVENTS } from '../db/listener.service.js';
import { Prisma, type Tx } from '../db/prisma.service.js';

export interface NewEvent {
  tradeId: string | null;
  tradeVersion: number | null;
  type: EventType;
  broadcast: boolean;
  priority: Priority;
  tone: string;
  title: string;
  body: string;
  payload: EventPayload;
  templateId?: string | null;
  actorId: string | null;
  idempotencyKey: string | null;
}

@Injectable()
export class EventStore {
  /**
   * The only write path for events. The event, its outbox row and the wake-up all commit or roll back
   * together with the caller's transaction, so nothing can be announced that was not recorded, and
   * nothing recorded can miss its notification job.
   */
  async append(tx: Tx, event: NewEvent) {
    const row = await tx.signalEvent.create({
      data: {
        tradeId: event.tradeId,
        tradeVersion: event.tradeVersion,
        type: event.type,
        broadcast: event.broadcast,
        priority: event.priority,
        tone: event.tone,
        title: event.title,
        body: event.body,
        payload: event.payload as unknown as Prisma.InputJsonValue,
        templateId: event.templateId ?? null,
        actorId: event.actorId,
        idempotencyKey: event.idempotencyKey,
      },
    });
    if (event.broadcast) {
      await tx.outboxEvent.create({ data: { eventId: row.id } });
      await tx.$executeRaw`SELECT pg_notify(${CH_EVENTS}, ${String(row.seq)})`;
    }
    return row;
  }
}
