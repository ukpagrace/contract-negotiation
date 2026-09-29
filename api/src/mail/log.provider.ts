import { Injectable, Logger } from '@nestjs/common';

import type { MailProvider, OutboundEmail } from './mail.provider.js';

/**
 * Development default: prints the mail instead of sending it, so sign-in works
 * with no provider account. Also the recorder tests read, which is why sent
 * mail is kept in memory.
 */
@Injectable()
export class LogProvider implements MailProvider {
  private readonly logger = new Logger('Mail');
  readonly sent: OutboundEmail[] = [];

  async send(email: OutboundEmail): Promise<void> {
    this.sent.push(email);
    this.logger.log(`To ${email.to} | ${email.subject}\n${email.text}`);
  }

  lastTo(address: string): OutboundEmail | undefined {
    return [...this.sent].reverse().find((email) => email.to === address.toLowerCase());
  }

  clear(): void {
    this.sent.length = 0;
  }
}
