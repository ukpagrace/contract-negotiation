import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { EditorService } from './editor.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ContractsController],
  providers: [ContractsService, EditorService],
})
export class ContractsModule {}
