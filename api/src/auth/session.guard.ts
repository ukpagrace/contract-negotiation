import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import type { User } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';

export const SESSION_COOKIE = 'session';

export interface AuthenticatedRequest extends Request {
  user: User;
  sessionToken: string;
}

export function sessionToken(request: Request): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = sessionToken(request);
    if (!token) {
      throw new UnauthorizedException('Sign in to continue.');
    }
    request.user = await this.auth.resolveSession(token);
    request.sessionToken = token;
    return true;
  }
}
