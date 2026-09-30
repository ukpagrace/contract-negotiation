import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration.js';
import { AI_PROVIDER, type AiProvider } from './ai.provider.js';
import { ClaudeProvider } from './claude.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      // A new AI company gets its own provider class and a branch here, chosen by ai.provider.
      useFactory: (config: ConfigService<AppConfig, true>): AiProvider => new ClaudeProvider(config.get('ai', { infer: true })),
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
