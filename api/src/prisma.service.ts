import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import type { AppConfig } from './config/configuration.js';
import { PrismaClient } from './generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<AppConfig, true>) {
    super({ adapter: new PrismaPg({ connectionString: config.get('databaseUrl', { infer: true }) }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
