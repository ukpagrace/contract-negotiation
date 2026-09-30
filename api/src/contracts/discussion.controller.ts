import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { Visibility } from '../generated/prisma/client.js';
import { ContractsService } from './contracts.service.js';
import { DiscussionService, type ChatItem, type NewThread, type ThreadItem } from './discussion.service.js';
import { EventsService } from './events.service.js';

function parseBody(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0 || text.length > 5000) {
    throw new BadRequestException('Messages must be 1–5000 characters.');
  }
  return text;
}

function parseVisibility(value: unknown): Visibility {
  if (value !== Visibility.SHARED && value !== Visibility.INTERNAL) {
    throw new BadRequestException('visibility must be SHARED or INTERNAL.');
  }
  return value;
}

function parseAnchorPart(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new BadRequestException('Select some text to comment on.');
  }
  return value;
}

function parseThread(body: Record<string, unknown>): NewThread {
  const thread: NewThread = { visibility: parseVisibility(body.visibility), body: parseBody(body.body) };
  if (typeof body.changeId === 'string') {
    return { ...thread, changeId: body.changeId };
  }
  const anchor = (body.anchor ?? {}) as Record<string, unknown>;
  const quote = parseAnchorPart(anchor.quote, 2000);
  if (quote.trim().length === 0) {
    throw new BadRequestException('Select some text to comment on.');
  }
  return { ...thread, anchor: { quote, prefix: parseAnchorPart(anchor.prefix, 100), suffix: parseAnchorPart(anchor.suffix, 100) } };
}

@Controller('contracts/:id')
@UseGuards(SessionGuard)
export class DiscussionController {
  constructor(
    private readonly discussion: DiscussionService,
    private readonly contracts: ContractsService,
    private readonly events: EventsService,
  ) {}

  // One stream per viewer, filtered to their side, so internal activity never reaches the other side.
  @Sse('events')
  async stream(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<Observable<MessageEvent>> {
    const party = await this.contracts.partyOf(request.user, id);
    return this.events.stream(id, party.id);
  }

  @Get('threads')
  listThreads(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<ThreadItem[]> {
    return this.discussion.listThreads(request.user, id);
  }

  @Post('threads')
  @HttpCode(204)
  createThread(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>): Promise<void> {
    return this.discussion.createThread(request.user, id, parseThread(body));
  }

  @Post('threads/:threadId/comments')
  @HttpCode(204)
  reply(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body('body') body: unknown,
  ): Promise<void> {
    return this.discussion.reply(request.user, id, threadId, parseBody(body));
  }

  @Patch('threads/:threadId')
  @HttpCode(204)
  setThreadStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body('status') status: unknown,
  ): Promise<void> {
    if (status !== 'OPEN' && status !== 'RESOLVED') {
      throw new BadRequestException('status must be OPEN or RESOLVED.');
    }
    return this.discussion.setThreadResolved(request.user, id, threadId, status === 'RESOLVED');
  }

  @Patch('comments/:commentId')
  @HttpCode(204)
  editComment(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body('body') body: unknown,
  ): Promise<void> {
    return this.discussion.editComment(request.user, id, commentId, parseBody(body));
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  deleteComment(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Param('commentId') commentId: string): Promise<void> {
    return this.discussion.editComment(request.user, id, commentId, null);
  }

  @Get('chat')
  listChat(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<ChatItem[]> {
    return this.discussion.listChat(request.user, id);
  }

  @Post('chat')
  @HttpCode(204)
  postChat(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('visibility') visibility: unknown,
    @Body('body') body: unknown,
  ): Promise<void> {
    return this.discussion.postChat(request.user, id, parseVisibility(visibility), parseBody(body));
  }

  @Patch('chat/:messageId')
  @HttpCode(204)
  editChat(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body('body') body: unknown,
  ): Promise<void> {
    return this.discussion.editChat(request.user, id, messageId, parseBody(body));
  }

  @Delete('chat/:messageId')
  @HttpCode(204)
  deleteChat(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Param('messageId') messageId: string): Promise<void> {
    return this.discussion.editChat(request.user, id, messageId, null);
  }
}
