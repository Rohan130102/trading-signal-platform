import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './app.module.js';
import { log } from './common/log.js';
import { WorkerService } from './notifications/worker.service.js';

process.on('unhandledRejection', (reason) => {
  log('error', 'unhandled_rejection', { error: reason instanceof Error ? reason.message : String(reason) });
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  await app.get(WorkerService).start();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
