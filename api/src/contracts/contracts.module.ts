import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { DiscussionController } from './discussion.controller.js';
import { DiscussionService } from './discussion.service.js';
import { EditorService } from './editor.service.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ContractsController, DiscussionController],
  providers: [ContractsService, EditorService, DiscussionService, EventsService],
})
export class ContractsModule {}
