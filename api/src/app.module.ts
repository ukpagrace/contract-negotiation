import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module.js';
import { loadConfig } from './config/configuration.js';
import { MailModule } from './mail/mail.module.js';
import { PrismaModule } from './prisma.service.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }), PrismaModule, MailModule, AuthModule],
})
export class AppModule {}
