import { BadRequestException, Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';

import type { AiTurn } from '../ai/ai.provider.js';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { AiService } from './ai.service.js';

// The conversation so far, kept by the page: alternating turns, starting and ending with the person.
function parseTurns(value: unknown): AiTurn[] {
  const invalid = () => new BadRequestException('Send the conversation as up to 40 alternating messages, ending with your question.');
  if (!Array.isArray(value) || value.length === 0 || value.length > 40 || value.length % 2 === 0) throw invalid();
  return value.map((turn: unknown, i) => {
    const { role, content } = (turn ?? {}) as { role?: unknown; content?: unknown };
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected || typeof content !== 'string' || !content.trim() || content.length > 4000) {
      throw invalid();
    }
    return { role: expected, content };
  });
}

@Controller('contracts/:id/ai')
@UseGuards(SessionGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('explain')
  @HttpCode(200)
  async explain(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body('changeId') changeId: unknown): Promise<{ text: string }> {
    if (typeof changeId !== 'string') {
      throw new BadRequestException('changeId is required.');
    }
    return { text: await this.ai.explainChange(request.user, id, changeId) };
  }

  @Post('summary')
  @HttpCode(200)
  async summary(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<{ text: string }> {
    return { text: await this.ai.summarize(request.user, id) };
  }

  @Post('ask')
  @HttpCode(200)
  async ask(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body('turns') turns: unknown): Promise<{ text: string }> {
    return { text: await this.ai.chat(request.user, id, parseTurns(turns)) };
  }
}
