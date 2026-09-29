import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration.js';
import { LogProvider } from './log.provider.js';
import { MAIL_PROVIDER, type MailProvider } from './mail.provider.js';
import { ResendProvider } from './resend.provider.js';

@Global()
@Module({
  providers: [
    LogProvider,
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService, LogProvider],
      useFactory: (config: ConfigService<AppConfig, true>, log: LogProvider): MailProvider =>
        config.get('mail', { infer: true }).provider === 'resend'
          ? new ResendProvider(config)
          : log,
    },
  ],
  exports: [MAIL_PROVIDER, LogProvider],
})
export class MailModule {}
