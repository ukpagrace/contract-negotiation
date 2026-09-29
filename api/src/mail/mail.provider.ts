export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * The only mail surface the application knows about. Resend lives behind it, so
 * swapping provider is one file and tests can assert on a recorded list instead
 * of sending anything.
 */
export interface MailProvider {
  send(email: OutboundEmail): Promise<void>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
