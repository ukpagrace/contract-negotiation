import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { DiscussionController } from './discussion.controller.js';
import { DiscussionService } from './discussion.service.js';
import { EditorService } from './editor.service.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ContractsController, DiscussionController, AiController],
  providers: [ContractsService, EditorService, DiscussionService, EventsService, AiService],
})
export class ContractsModule {}
