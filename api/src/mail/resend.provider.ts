import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration.js';
import type { MailProvider, OutboundEmail } from './mail.provider.js';

interface ResendError {
  message?: string;
  name?: string;
}

/** Talks to Resend's REST API directly - one endpoint, no SDK to keep current. */
@Injectable()
export class ResendProvider implements MailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const mail = config.get('mail', { infer: true });
    this.apiKey = mail.resendApiKey;
    this.from = mail.from;
  }

  async send(email: OutboundEmail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ResendError;
      // Deliberately does not include the email body in the log.
      this.logger.error(`Resend rejected mail to ${email.to}: ${body.message ?? response.status}`);
      throw new Error(`Could not send email: ${body.message ?? response.statusText}`);
    }
  }
}
