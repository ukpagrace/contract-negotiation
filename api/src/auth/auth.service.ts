import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { AppConfig } from '../config/configuration.js';
import type { User } from '../generated/prisma/client.js';
import { MAIL_PROVIDER, type MailProvider } from '../mail/mail.provider.js';
import { signInCodeEmail } from '../mail/mail.templates.js';
import { PrismaService } from '../prisma.service.js';

const scryptAsync = promisify(scrypt);

// Six digits is only a million options, so a leaked table must be slow to brute force.
async function hashCode(code: string, salt: string): Promise<Buffer> {
  return (await scryptAsync(code, salt, 32)) as Buffer;
}

// Session tokens are 32 random bytes; nothing to brute force, so a fast hash is enough.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async requestCode(email: string): Promise<void> {
    const settings = this.config.get('loginCode', { infer: true });

    const recent = await this.prisma.loginCode.count({
      where: { email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= settings.maxPerHour) {
      throw new HttpException(
        'Too many codes requested for this address. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 10 ** settings.length).toString().padStart(settings.length, '0');
    const salt = randomBytes(16).toString('hex');
    await this.prisma.loginCode.create({
      data: {
        email,
        codeHash: (await hashCode(code, salt)).toString('hex'),
        salt,
        expiresAt: new Date(Date.now() + settings.ttlMinutes * 60 * 1000),
      },
    });

    await this.mail.send(signInCodeEmail(email, code, settings.ttlMinutes));
  }

  async verifyCode(email: string, code: string): Promise<{ token: string; expiresAt: Date; user: User }> {
    const settings = this.config.get('loginCode', { infer: true });

    const record = await this.prisma.loginCode.findFirst({
      where: { email, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Same message for unknown email and wrong code so addresses can't be probed.
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('That code is wrong or has expired.');
    }
    if (record.attempts >= settings.maxAttempts) {
      throw new HttpException('Too many attempts on this code. Request a new one.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const matches = timingSafeEqual(await hashCode(code, record.salt), Buffer.from(record.codeHash, 'hex'));
    if (!matches) {
      await this.prisma.loginCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('That code is wrong or has expired.');
    }

    await this.prisma.loginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    const user = await this.prisma.user.upsert({ where: { email }, create: { email }, update: {} });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get('sessionTtlDays', { infer: true }) * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });

    return { token, expiresAt, user };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  async resolveSession(token: string): Promise<User> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session has expired. Sign in again.');
    }
    return session.user;
  }

  async setName(userId: string, name: string): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { name } });
  }
}
