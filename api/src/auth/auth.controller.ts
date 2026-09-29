import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import type { AppConfig } from '../config/configuration.js';
import type { User } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, SessionGuard, type AuthenticatedRequest } from './session.guard.js';

export function parseEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Enter a valid email address.');
  }
  return email;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Post('request-code')
  @HttpCode(204)
  async requestCode(@Body('email') email: unknown): Promise<void> {
    await this.auth.requestCode(parseEmail(email));
  }

  // Session goes in an httpOnly cookie, not the body: SSE's EventSource can't send auth headers.
  @Post('verify-code')
  async verifyCode(
    @Body('email') email: unknown,
    @Body('code') code: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new BadRequestException('Code must be 6 digits.');
    }
    const session = await this.auth.verifyCode(parseEmail(email), code);
    response.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('appUrl', { infer: true }).startsWith('https'),
      expires: session.expiresAt,
    });
    return session.user;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(request.sessionToken);
    response.clearCookie(SESSION_COOKIE);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest): User {
    return request.user;
  }

  @Patch('me')
  @UseGuards(SessionGuard)
  async setName(@Req() request: AuthenticatedRequest, @Body('name') name: unknown): Promise<User> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new BadRequestException('Name must be 1–200 characters.');
    }
    return this.auth.setName(request.user.id, trimmed);
  }
}
