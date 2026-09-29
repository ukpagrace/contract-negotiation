import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import type { AppConfig } from '../config/configuration.js';
import { ContractStatus, type Prisma, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { ContractsService } from './contracts.service.js';

const LOCK_TTL_MS = 60_000;

export interface LockHolder {
  userId: string;
  name: string;
}

export interface ImportedDocx {
  title: string;
  content: Prisma.InputJsonObject;
  commentsDropped: boolean;
  s3Key: string;
}

@Injectable()
export class EditorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EditorService.name);
  private readonly redis: ReturnType<typeof createClient>;
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.redis = createClient({ url: config.get('redisUrl', { infer: true }) });
    const r2 = config.get('r2', { infer: true });
    this.bucket = r2.bucket;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.close();
  }

  async getLock(user: User, contractId: string): Promise<LockHolder | null> {
    await this.contracts.partyOf(user, contractId);
    const holderId = await this.redis.get(this.lockKey(contractId));
    return holderId ? this.holder(holderId) : null;
  }

  // Also the heartbeat: the editor calls this while the user is active to keep the lock alive.
  async acquireLock(user: User, contractId: string, takeOver: boolean): Promise<LockHolder> {
    await this.assertCanEdit(user, contractId);
    const key = this.lockKey(contractId);
    if (takeOver) {
      await this.redis.set(key, user.id, { expiration: { type: 'PX', value: LOCK_TTL_MS } });
    } else {
      const taken = await this.redis.set(key, user.id, { expiration: { type: 'PX', value: LOCK_TTL_MS }, condition: 'NX' });
      if (!taken) {
        const holderId = await this.redis.get(key);
        if (holderId && holderId !== user.id) {
          throw new ConflictException(`${(await this.holder(holderId)).name} is editing.`);
        }
        await this.redis.set(key, user.id, { expiration: { type: 'PX', value: LOCK_TTL_MS } });
      }
    }
    return this.holder(user.id);
  }

  async releaseLock(user: User, contractId: string): Promise<void> {
    await this.contracts.partyOf(user, contractId);
    const key = this.lockKey(contractId);
    if ((await this.redis.get(key)) === user.id) {
      await this.redis.del(key);
    }
  }

  async saveDraft(user: User, contractId: string, content: Prisma.InputJsonObject): Promise<void> {
    await this.assertHoldsLock(user, contractId);
    await this.prisma.contract.update({ where: { id: contractId }, data: { draftContent: content } });
    await this.redis.del(this.lockKey(contractId));
  }

  async replaceWithUpload(
    user: User,
    contractId: string,
    file: Buffer,
  ): Promise<{ content: Prisma.InputJsonObject; commentsDropped: boolean }> {
    await this.assertHoldsLock(user, contractId);
    const imported = await this.importDocx(file);
    await this.prisma.$transaction([
      this.prisma.contract.update({ where: { id: contractId }, data: { draftContent: imported.content } }),
      this.prisma.uploadedFile.create({ data: { contractId, s3Key: imported.s3Key, uploadedById: user.id } }),
    ]);
    return { content: imported.content, commentsDropped: imported.commentsDropped };
  }

  async importDocx(file: Buffer): Promise<ImportedDocx> {
    const response = await fetch(`${this.config.get('extractorUrl', { infer: true })}/convert`, {
      method: 'POST',
      body: new Uint8Array(file),
      signal: AbortSignal.timeout(this.config.get('extractorTimeoutMs', { infer: true })),
    });
    const result = (await response.json()) as Omit<ImportedDocx, 's3Key'> & { message?: string };
    if (!response.ok) {
      throw new UnprocessableEntityException(result.message ?? 'That file could not be converted.');
    }

    const s3Key = `uploads/${randomUUID()}.docx`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: file,
          ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
    } catch (err) {
      this.logger.error(`Storing upload failed: ${(err as Error).message}`);
      throw new BadGatewayException("The file couldn't be stored. Try again in a moment.");
    }
    return { title: result.title, content: result.content, commentsDropped: result.commentsDropped, s3Key };
  }

  private async assertCanEdit(user: User, contractId: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (contract.currentTurnPartyId !== party.id) {
      throw new ForbiddenException("It's the other side's turn. You can edit once they send it back.");
    }
    // Edits after the first send must be tracked changes, which aren't built yet.
    if (contract.status !== ContractStatus.DRAFT) {
      throw new ForbiddenException('This contract can only be edited as a draft for now.');
    }
  }

  private async assertHoldsLock(user: User, contractId: string): Promise<void> {
    await this.assertCanEdit(user, contractId);
    if ((await this.redis.get(this.lockKey(contractId))) !== user.id) {
      throw new ConflictException('Your editing session ended. Open the editor again to continue.');
    }
  }

  private async holder(userId: string): Promise<LockHolder> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { userId, name: user.name ?? user.email };
  }

  private lockKey(contractId: string): string {
    return `lock:contract:${contractId}`;
  }
}
