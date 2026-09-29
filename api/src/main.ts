import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Contract documents are sent whole on save, so the 100kb default is too small.
  app.useBodyParser('json', { limit: '5mb' });
  app.enableCors({ origin: process.env.APP_URL ?? 'http://localhost:5173', credentials: true });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
