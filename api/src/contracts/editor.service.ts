import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import { hashToken } from '../auth/auth.service.js';
import type { AppConfig } from '../config/configuration.js';
import {
  ChangeStatus,
  ContractStatus,
  PartyRole,
  SignaturePlacement,
  type Contract,
  type ContractParty,
  type Prisma,
  type User,
} from '../generated/prisma/client.js';
import { MAIL_PROVIDER, type MailProvider, type OutboundEmail } from '../mail/mail.provider.js';
import { contractSentEmail, readyToSignEmail, reopenedEmail } from '../mail/mail.templates.js';
import { PrismaService } from '../prisma.service.js';
import {
  baseSignature,
  collectChanges,
  diffDocs,
  mapOffset,
  placeSpots,
  plainText,
  resolveChange,
  sameIgnoringSpots,
  settleChanges,
  spotRoles,
  type ChangeKind,
  type DocNode,
  type SpotRole,
} from './changes.js';
import { ContractsService, INVITE_TTL_MS, type ContractDetail } from './contracts.service.js';
import { EventsService } from './events.service.js';

const LOCK_TTL_MS = 60_000;

// Statuses in which the two sides are still negotiating (sent at least once, not yet agreed).
const NEGOTIATING: ContractStatus[] = [ContractStatus.WITH_PROPOSER, ContractStatus.WITH_COUNTERPARTY];

export type ExportFormat = 'docx' | 'pdf';

export const fileName = (title: string, extension: string) => `${title.replace(/[^\w .-]+/g, '').trim() || 'contract'}.${extension}`;

export interface LockHolder {
  userId: string;
  name: string;
}

export interface ChangeItem {
  id: string;
  type: ChangeKind;
  text: string;
  authorPartyId: string;
  authorOrg: string;
  authorName: string;
  createdAt: Date;
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
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly events: EventsService,
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
    const party = await this.assertCanEdit(user, contractId);
    const key = this.lockKey(contractId);
    if (takeOver) {
      await this.redis.set(key, user.id, { expiration: { type: 'PX', value: LOCK_TTL_MS } });
      this.events.publish(contractId, 'lock', party.id);
    } else {
      const taken = await this.redis.set(key, user.id, { expiration: { type: 'PX', value: LOCK_TTL_MS }, condition: 'NX' });
      if (!taken) {
        const holderId = await this.redis.get(key);
        if (holderId && holderId !== user.id) {
          throw new ConflictException(`${(await this.holder(holderId)).name} is editing.`);
        }
        await this.redis.set(key, user.id, { expiration: { type: 'PX', value: LOCK_TTL_MS } });
      } else {
        this.events.publish(contractId, 'lock', party.id);
      }
    }
    return this.holder(user.id);
  }

  async releaseLock(user: User, contractId: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const key = this.lockKey(contractId);
    if ((await this.redis.get(key)) === user.id) {
      await this.redis.del(key);
      this.events.publish(contractId, 'lock', party.id);
    }
  }

  async saveDraft(user: User, contractId: string, content: Prisma.InputJsonObject): Promise<void> {
    await this.assertHoldsLock(user, contractId);
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    await this.writeDraft(user, party, contract, content);
    await this.redis.del(this.lockKey(contractId));
    this.events.publish(contractId, 'document', party.id);
    this.events.publish(contractId, 'lock', party.id);
  }

  // Checks the new draft only adds or drops the saver's own tracked changes, keeps the Change
  // rows in step, and writes it along with `extra`. Signature spots must stay unless `spotsMayGo`
  // (uploads and restores rebuild the document without them).
  private async writeDraft(
    user: User,
    party: ContractParty,
    contract: Contract,
    content: Prisma.InputJsonObject,
    extra: Prisma.PrismaPromise<unknown>[] = [],
    spotsMayGo = false,
  ): Promise<void> {
    const contractId = contract.id;
    const writes: Prisma.PrismaPromise<unknown>[] = [...extra];
    const previous = contract.draftContent as unknown as DocNode;
    const next = content as unknown as DocNode;

    if (!spotsMayGo && spotRoles(previous).join() !== spotRoles(next).join()) {
      throw new BadRequestException("Signature spots can't be changed while editing. Reload the page and try again.");
    }
    // Agreeing to sign is agreeing to this text, so any change to it clears both sides' Ready.
    const textChanged = !sameIgnoringSpots(previous, next);
    if (textChanged) writes.push(this.clearReady(contractId));

    if (contract.status !== ContractStatus.DRAFT) {
      if (baseSignature(previous, party.id) !== baseSignature(next, party.id)) {
        throw new BadRequestException('Only tracked changes can be saved after sending. Reload the page and try again.');
      }

      const found = collectChanges(next);
      const rows = await this.prisma.change.findMany({ where: { contractId } });
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      for (const [id, change] of found) {
        const row = rowsById.get(id);
        if (change.authorPartyId !== party.id) continue;
        if (row && (row.authorPartyId !== party.id || row.status !== ChangeStatus.PENDING)) {
          throw new BadRequestException('A change in this document is invalid. Reload the page and try again.');
        }
        if (!row) {
          writes.push(
            this.prisma.change.create({
              data: { id, contractId, type: change.type, authorPartyId: party.id, authorUserId: user.id },
            }),
          );
        }
      }
      // Own pending changes no longer in the document were undone while editing.
      const withdrawn = rows.filter((row) => row.authorPartyId === party.id && row.status === ChangeStatus.PENDING && !found.has(row.id));
      if (withdrawn.length > 0) {
        writes.push(this.prisma.change.deleteMany({ where: { id: { in: withdrawn.map((row) => row.id) } } }));
      }
    }

    await this.prisma.$transaction([
      this.prisma.contract.update({ where: { id: contractId }, data: { draftContent: content } }),
      ...writes,
    ]);
    if (textChanged) this.events.publish(contractId, 'contract');
  }

  private clearReady(contractId: string): Prisma.PrismaPromise<unknown> {
    return this.prisma.contractParty.updateMany({ where: { contractId }, data: { readyAt: null, readyByUserId: null } });
  }

  async listChanges(user: User, contractId: string): Promise<ChangeItem[]> {
    const contract = await this.contracts.get(user, contractId);
    const found = collectChanges(contract.draftContent as unknown as DocNode | null);
    const rows = await this.prisma.change.findMany({
      where: { contractId, id: { in: [...found.keys()] }, status: ChangeStatus.PENDING },
      include: { authorUser: true, authorParty: true },
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    return [...found].flatMap(([id, change]) => {
      const row = rowsById.get(id);
      if (!row) return [];
      return [{
        id,
        type: change.type,
        text: change.text,
        authorPartyId: row.authorPartyId,
        authorOrg: row.authorParty.orgName,
        authorName: row.authorUser.name ?? row.authorUser.email,
        createdAt: row.createdAt,
      }];
    });
  }

  // accept/reject resolve the other side's change; withdraw undoes one of your own.
  async resolve(user: User, contractId: string, changeId: string, action: 'accept' | 'reject' | 'withdraw'): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (contract.currentTurnPartyId !== party.id) {
      throw new ForbiddenException('You can resolve changes on your turn.');
    }
    const holderId = await this.redis.get(this.lockKey(contractId));
    if (holderId) {
      throw new ConflictException(
        holderId === user.id ? 'Save or cancel your edits first.' : `${(await this.holder(holderId)).name} is editing. Try again when they save.`,
      );
    }
    const change = await this.prisma.change.findFirst({ where: { id: changeId, contractId } });
    if (!change) {
      throw new NotFoundException('Change not found.');
    }
    const own = change.authorPartyId === party.id;
    if (own !== (action === 'withdraw')) {
      throw new ForbiddenException(own ? "You can't accept or reject your own changes." : 'You can only withdraw your own changes.');
    }

    const next = resolveChange(contract.draftContent as unknown as DocNode, changeId, action === 'accept');
    await this.prisma.$transaction(async (tx) => {
      const where = { id: changeId, status: ChangeStatus.PENDING };
      const updated =
        action === 'withdraw'
          ? await tx.change.deleteMany({ where })
          : await tx.change.updateMany({
              where,
              data: {
                status: action === 'accept' ? ChangeStatus.ACCEPTED : ChangeStatus.REJECTED,
                resolvedByUserId: user.id,
                resolvedAt: new Date(),
              },
            });
      if (updated.count === 0) {
        throw new ConflictException('This change has already been resolved.');
      }
      await tx.contract.update({ where: { id: contractId }, data: { draftContent: next as unknown as Prisma.InputJsonObject } });
      await tx.contractParty.updateMany({ where: { contractId }, data: { readyAt: null, readyByUserId: null } });
      await tx.activityLog.create({
        data: { contractId, actorUserId: user.id, type: `CHANGE_${action.toUpperCase()}`, payload: { changeId } },
      });
    });
    this.events.publish(contractId, 'document', party.id);
    this.events.publish(contractId, 'contract');
  }

  async replaceWithUpload(
    user: User,
    contractId: string,
    file: Buffer,
  ): Promise<{ content: Prisma.InputJsonObject; commentsDropped: boolean }> {
    await this.assertHoldsLock(user, contractId);
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (contract.status !== ContractStatus.DRAFT) this.assertNoTheirChanges(contract, party);
    const imported = await this.importDocx(file);
    const stored = this.prisma.uploadedFile.create({ data: { contractId, s3Key: imported.s3Key, uploadedById: user.id } });

    if (contract.status === ContractStatus.DRAFT) {
      await this.prisma.$transaction([
        this.prisma.contract.update({ where: { id: contractId }, data: { draftContent: imported.content } }),
        stored,
      ]);
      return { content: imported.content, commentsDropped: imported.commentsDropped };
    }
    const content = await this.proposeAsChanges(user, party, contract, imported.content as unknown as DocNode, [stored]);
    return { content, commentsDropped: imported.commentsDropped };
  }

  // Restoring brings back what this side was proposing in that version (the other side's
  // proposals in it are undone), as this side's tracked changes; the next send makes it a new version.
  async restoreVersion(user: User, contractId: string, versionNumber: number): Promise<void> {
    const party = await this.assertCanEdit(user, contractId);
    const holderId = await this.redis.get(this.lockKey(contractId));
    if (holderId) {
      throw new ConflictException(
        holderId === user.id ? 'Save or cancel your edits first.' : `${(await this.holder(holderId)).name} is editing. Try again when they save.`,
      );
    }
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    this.assertNoTheirChanges(contract, party);
    const version = await this.prisma.contractVersion.findUnique({ where: { contractId_versionNumber: { contractId, versionNumber } } });
    if (!version) {
      throw new NotFoundException('Version not found.');
    }
    const restored = settleChanges(version.content as unknown as DocNode, (_kind, author) => (author === party.id ? 'accept' : 'reject'));
    await this.proposeAsChanges(user, party, contract, restored, [
      this.prisma.activityLog.create({ data: { contractId, actorUserId: user.id, type: 'VERSION_RESTORED', payload: { versionNumber } } }),
    ]);
    this.events.publish(contractId, 'document', party.id);
  }

  // Replaces this side's pending changes with the differences between the agreed text and `next`.
  private async proposeAsChanges(
    user: User,
    party: ContractParty,
    contract: Contract,
    next: DocNode,
    extra: Prisma.PrismaPromise<unknown>[],
  ): Promise<Prisma.InputJsonObject> {
    const agreed = settleChanges(contract.draftContent as unknown as DocNode, (_kind, author) => (author === party.id ? 'reject' : null));
    const content = diffDocs(agreed, next, party.id, randomUUID) as unknown as Prisma.InputJsonObject;
    await this.writeDraft(user, party, contract, content, extra, true);
    return content;
  }

  private assertNoTheirChanges(contract: Contract, party: ContractParty): void {
    const theirs = [...collectChanges(contract.draftContent as unknown as DocNode).values()].some((c) => c.authorPartyId !== party.id);
    if (theirs) {
      throw new ConflictException("Accept or reject the other side's changes first.");
    }
  }

  async send(user: User, contractId: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: { parties: true } });
    if (contract.currentTurnPartyId !== party.id) {
      throw new ForbiddenException("It's the other side's turn.");
    }
    if (contract.status === ContractStatus.READY_TO_SIGN || contract.status === ContractStatus.SIGNED) {
      throw new ConflictException('This contract can no longer be sent.');
    }
    const holderId = await this.redis.get(this.lockKey(contractId));
    if (holderId) {
      throw new ConflictException(
        holderId === user.id
          ? 'Save or cancel your edits before sending.'
          : `${(await this.holder(holderId)).name} is editing. Ask them to save first.`,
      );
    }

    const receiver = contract.parties.find((p) => p.id !== party.id)!;
    await this.prisma.$transaction(async (tx) => {
      // Conditional update so two simultaneous sends can't both succeed.
      const switched = await tx.contract.updateMany({
        where: { id: contractId, currentTurnPartyId: party.id },
        data: {
          currentTurnPartyId: receiver.id,
          status: receiver.role === PartyRole.PROPOSER ? ContractStatus.WITH_PROPOSER : ContractStatus.WITH_COUNTERPARTY,
        },
      });
      if (switched.count === 0) {
        throw new ConflictException('This contract was just sent.');
      }
      const last = await tx.contractVersion.findFirst({ where: { contractId }, orderBy: { versionNumber: 'desc' } });
      const versionNumber = (last?.versionNumber ?? 0) + 1;
      await tx.contractVersion.create({
        data: { contractId, versionNumber, content: contract.draftContent as Prisma.InputJsonValue, sentByPartyId: party.id },
      });
      await tx.activityLog.create({
        data: { contractId, actorUserId: user.id, type: 'SENT', payload: { versionNumber } },
      });
    });
    this.events.publish(contractId, 'document');

    const appUrl = this.config.get('appUrl', { infer: true });
    const recipients: { email: string; link: string }[] = [];
    const participants = await this.prisma.participant.findMany({ where: { partyId: receiver.id }, include: { user: true } });
    for (const participant of participants) {
      recipients.push({ email: participant.user.email, link: `${appUrl}/contracts/${contractId}` });
    }
    // People who haven't joined yet get a fresh link that signs them in and adds them to this side.
    const pending = await this.prisma.invite.findMany({ where: { partyId: receiver.id, acceptedAt: null } });
    for (const invite of pending) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      recipients.push({ email: invite.email, link: `${appUrl}/invite/${token}` });
    }
    for (const recipient of recipients) {
      // The send is already committed; a failed email shouldn't report the send as failed.
      try {
        await this.mail.send(contractSentEmail(recipient.email, party.orgName, contract.title, recipient.link));
      } catch (err) {
        this.logger.error(`Send email to ${recipient.email} failed: ${(err as Error).message}`);
      }
    }
  }

  // Ready to sign: each side confirms the text as last sent, with nothing pending. The proposer
  // also says where signatures go. Once both have, the contract is Ready to sign; returns whether
  // this click made that switch (the caller then starts signing, which tells the pages).
  async markReady(user: User, contractId: string, placement: SignaturePlacement | undefined): Promise<boolean> {
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.contracts.get(user, contractId);
    this.assertAgreed(contract, party);
    if (party.role === PartyRole.PROPOSER) {
      if (!placement) {
        throw new BadRequestException('Choose where signatures go.');
      }
      const roles = spotRoles(contract.draftContent as unknown as DocNode);
      if (placement === SignaturePlacement.SPOTS && !(roles.includes('PROPOSER') && roles.includes('COUNTERPARTY'))) {
        throw new BadRequestException('Place both signature spots first.');
      }
    }

    await this.prisma.$transaction([
      this.prisma.contractParty.update({ where: { id: party.id }, data: { readyAt: new Date(), readyByUserId: user.id } }),
      ...(party.role === PartyRole.PROPOSER
        ? [this.prisma.contract.update({ where: { id: contractId }, data: { signaturePlacement: placement } })]
        : []),
      this.prisma.activityLog.create({ data: { contractId, actorUserId: user.id, type: 'READY', payload: { partyId: party.id } } }),
    ]);
    // Conditional, so when both click at once exactly one request makes the switch.
    const switched = await this.prisma.contract.updateMany({
      where: { id: contractId, status: { in: NEGOTIATING }, parties: { every: { readyAt: { not: null } } } },
      data: { status: ContractStatus.READY_TO_SIGN },
    });
    if (switched.count === 0) {
      this.events.publish(contractId, 'contract');
      return false;
    }

    await this.prisma.activityLog.create({ data: { contractId, actorUserId: user.id, type: 'READY_TO_SIGN', payload: {} } });
    const link = `${this.config.get('appUrl', { infer: true })}/contracts/${contractId}`;
    await this.emailBothSides(contractId, (email) => readyToSignEmail(email, contract.title, link));
    return true;
  }

  async undoReady(user: User, contractId: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (!NEGOTIATING.includes(contract.status)) {
      throw new ConflictException('Both sides are already ready. Reopen the contract to make changes.');
    }
    await this.prisma.contractParty.update({ where: { id: party.id }, data: { readyAt: null, readyByUserId: null } });
    this.events.publish(contractId, 'contract');
  }

  // Spots are placed by the proposer, only while Ready to sign is possible, and aren't tracked
  // changes. `baseText` is the text they were placed on, so a stale page can't misplace them.
  async placeSignatureSpots(user: User, contractId: string, offsets: Record<SpotRole, number>, baseText: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    if (party.role !== PartyRole.PROPOSER) {
      throw new ForbiddenException('Only the proposing side places signature spots.');
    }
    this.assertAgreed(await this.contracts.get(user, contractId), party);
    const holderId = await this.redis.get(this.lockKey(contractId));
    if (holderId) {
      throw new ConflictException(`${(await this.holder(holderId)).name} is editing. Try again when they finish.`);
    }
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const draft = contract.draftContent as unknown as DocNode;
    const text = plainText(draft);
    if (text.replace(/\s+/g, '') !== baseText.replace(/\s+/g, '')) {
      throw new ConflictException('The document changed. Reload the page and try again.');
    }
    let placed: DocNode;
    try {
      placed = placeSpots(draft, {
        PROPOSER: mapOffset(baseText, text, offsets.PROPOSER),
        COUNTERPARTY: mapOffset(baseText, text, offsets.COUNTERPARTY),
      });
    } catch {
      throw new BadRequestException('Signature spots must be placed in the text.');
    }
    await this.prisma.$transaction([
      this.prisma.contract.update({ where: { id: contractId }, data: { draftContent: placed as unknown as Prisma.InputJsonObject } }),
      this.prisma.activityLog.create({ data: { contractId, actorUserId: user.id, type: 'SIGNATURE_SPOTS_PLACED', payload: {} } }),
    ]);
    this.events.publish(contractId, 'document');
  }

  // Back to negotiating from Ready to sign. The text doesn't change; the reopening side gets the turn.
  // `discardedOrg`: a side whose signature was thrown away by this, for the email.
  async reopen(user: User, contractId: string, discardedOrg?: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const reopened = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.contract.updateMany({
        where: { id: contractId, status: ContractStatus.READY_TO_SIGN },
        data: {
          status: party.role === PartyRole.PROPOSER ? ContractStatus.WITH_PROPOSER : ContractStatus.WITH_COUNTERPARTY,
          currentTurnPartyId: party.id,
        },
      });
      if (updated.count === 0) return false;
      await tx.contractParty.updateMany({ where: { contractId }, data: { readyAt: null, readyByUserId: null, signedAt: null } });
      await tx.activityLog.create({ data: { contractId, actorUserId: user.id, type: 'REOPENED', payload: { discardedOrg } } });
      return true;
    });
    if (!reopened) {
      throw new ConflictException('Only a contract that is ready to sign can be reopened.');
    }
    this.events.publish(contractId, 'document');
    const link = `${this.config.get('appUrl', { infer: true })}/contracts/${contractId}`;
    await this.emailBothSides(contractId, (email) => reopenedEmail(email, party.orgName, contract.title, link, discardedOrg));
  }

  // A clean copy of the document the user can see, with nothing pending.
  async export(user: User, contractId: string, format: ExportFormat): Promise<{ file: Buffer; filename: string; type: string }> {
    const contract = await this.contracts.get(user, contractId);
    if (!contract.draftContent) {
      throw new ConflictException("There's nothing to export until the other side sends the contract.");
    }
    if (collectChanges(contract.draftContent as unknown as DocNode).size > 0) {
      throw new ConflictException('Changes are still pending. Accept or reject them before exporting.');
    }
    const { file, type } = await this.render(contractId, contract.draftContent, contract.title, format);
    return { file, filename: fileName(contract.title, format), type };
  }

  // The converter's Word or PDF of a document; with `signing`, laid out for signing (see SigningService).
  async render(
    contractId: string,
    content: Prisma.JsonValue,
    title: string,
    format: ExportFormat,
    signing?: {
      placement: SignaturePlacement;
      orgs: Record<SpotRole, string>;
      signatures?: Record<SpotRole, { image: string; date: string }>;
      audit?: { headers: string[]; rows: string[][]; notes: string[] };
    },
  ): Promise<{ file: Buffer; type: string }> {
    // The newest upload lends the export its page size, margins, headers, footers and styles.
    const upload = await this.prisma.uploadedFile.findFirst({ where: { contractId }, orderBy: { createdAt: 'desc' } });
    const template = upload ? (await this.readFile(upload.s3Key)).toString('base64') : undefined;
    const response = await fetch(`${this.config.get('extractorUrl', { infer: true })}/export?format=${format}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, title, signing, template }),
      signal: AbortSignal.timeout(this.config.get('extractorTimeoutMs', { infer: true })),
    });
    if (!response.ok) {
      const { message } = (await response.json().catch(() => ({}))) as { message?: string };
      throw new ServiceUnavailableException(message ?? "The file couldn't be made. Try again in a moment.");
    }
    return { file: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async storeFile(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async readFile(key: string): Promise<Buffer> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await object.Body!.transformToByteArray());
  }

  private assertAgreed(contract: ContractDetail, party: ContractParty): void {
    if (!NEGOTIATING.includes(contract.status)) {
      throw new ConflictException(
        contract.status === ContractStatus.DRAFT ? 'Send the contract first.' : 'Both sides are already ready to sign.',
      );
    }
    if (contract.hasUnsentChanges) {
      throw new ConflictException(
        contract.currentTurnPartyId === party.id
          ? 'Send your latest changes first, so the other side sees the final text.'
          : "The other side has changes they haven't sent yet.",
      );
    }
    if (collectChanges(contract.draftContent as unknown as DocNode).size > 0) {
      throw new ConflictException('Changes are still pending. Every change must be accepted or rejected first.');
    }
  }

  async emailBothSides(contractId: string, build: (email: string) => OutboundEmail): Promise<void> {
    const participants = await this.prisma.participant.findMany({ where: { party: { contractId } }, include: { user: true } });
    for (const { user } of participants) {
      // The change is already committed; a failed email shouldn't report it as failed.
      try {
        await this.mail.send(build(user.email));
      } catch (err) {
        this.logger.error(`Email to ${user.email} failed: ${(err as Error).message}`);
      }
    }
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

  private async assertCanEdit(user: User, contractId: string): Promise<ContractParty> {
    const party = await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (contract.currentTurnPartyId !== party.id) {
      throw new ForbiddenException("It's the other side's turn. You can edit once they send it back.");
    }
    if (contract.status === ContractStatus.READY_TO_SIGN || contract.status === ContractStatus.SIGNED) {
      throw new ForbiddenException('This contract can no longer be edited.');
    }
    return party;
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
