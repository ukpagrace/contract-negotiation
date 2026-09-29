export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Seconds a presigned upload/download URL stays valid. */
  urlTtlSeconds: number;
}

export type MailProviderName = 'resend' | 'log';

export interface MailConfig {
  provider: MailProviderName;
  from: string;
  resendApiKey: string;
}

export interface LoginCodeConfig {
  length: number;
  ttlMinutes: number;
  /** Wrong guesses allowed before the code is burned. */
  maxAttempts: number;
  /** Codes issued per email per hour. */
  maxPerHour: number;
}

export interface AppConfig {
  port: number;
  appUrl: string;
  databaseUrl: string;
  extractorUrl: string;
  extractorTimeoutMs: number;
  maxUploadBytes: number;
  sessionTtlDays: number;
  loginCode: LoginCodeConfig;
  mail: MailConfig;
  r2: R2Config;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function numeric(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got '${raw}'`);
  }
  return parsed;
}

function mailProvider(): MailProviderName {
  const raw = (process.env.MAIL_PROVIDER ?? 'log').toLowerCase();
  if (raw !== 'resend' && raw !== 'log') {
    throw new Error(`MAIL_PROVIDER must be 'resend' or 'log', got '${raw}'`);
  }
  // Fail at boot rather than on the first sign-in attempt.
  if (raw === 'resend' && !process.env.RESEND_API_KEY) {
    throw new Error('MAIL_PROVIDER=resend requires RESEND_API_KEY');
  }
  return raw;
}

export function loadConfig(): AppConfig {
  return {
    port: numeric('PORT', 3000),
    appUrl: process.env.APP_URL ?? 'http://localhost:5173',
    databaseUrl: required('DATABASE_URL'),
    extractorUrl: process.env.EXTRACTOR_URL ?? 'http://localhost:8001',
    extractorTimeoutMs: numeric('EXTRACTOR_TIMEOUT_MS', 120_000),
    maxUploadBytes: numeric('MAX_UPLOAD_BYTES', 25 * 1024 * 1024),
    sessionTtlDays: numeric('SESSION_TTL_DAYS', 30),
    loginCode: {
      length: 6,
      ttlMinutes: numeric('LOGIN_CODE_TTL_MINUTES', 10),
      maxAttempts: numeric('LOGIN_CODE_MAX_ATTEMPTS', 5),
      maxPerHour: numeric('LOGIN_CODE_MAX_PER_HOUR', 5),
    },
    mail: {
      provider: mailProvider(),
      from: process.env.MAIL_FROM ?? 'Negotiation Platform <noreply@localhost>',
      resendApiKey: process.env.RESEND_API_KEY ?? '',
    },
    r2: {
      accountId: required('R2_ACCOUNT_ID'),
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
      bucket: required('R2_BUCKET'),
      urlTtlSeconds: numeric('R2_URL_TTL_SECONDS', 900),
    },
  };
}
