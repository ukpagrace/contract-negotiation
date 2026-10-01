import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';

import { hashToken } from '../auth/auth.service.js';
import type { AppConfig } from '../config/configuration.js';
import { ContractStatus, PartyRole, type SigningRequest, type User } from '../generated/prisma/client.js';
import { MAIL_PROVIDER, type MailProvider } from '../mail/mail.provider.js';
import { signedEmail, signInToSignEmail } from '../mail/mail.templates.js';
import { PrismaService } from '../prisma.service.js';
import { ContractsService, INVITE_TTL_MS } from './contracts.service.js';
import { EditorService, fileName } from './editor.service.js';
import { EventsService } from './events.service.js';

// Signing without an outside provider (simple electronic signatures). Each Ready to sign starts a
// round: the document to sign is fixed and fingerprinted, each side's chosen signer adds a
// signature image, and once both have, the signed copy gets the signatures and an audit page.

export type SignatureMethod = 'DRAWN' | 'TYPED' | 'UPLOADED';

export interface SignInput {
  image: Buffer;
  method: SignatureMethod;
  ip: string | undefined;
  userAgent: string | undefined;
}

const METHOD_LABEL: Record<SignatureMethod, string> = { DRAWN: 'Drawn', TYPED: 'Typed', UPLOADED: 'Uploaded image' };

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const day = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly editor: EditorService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly events: EventsService,
  ) {}

  // Called once both sides are ready. A failure is logged and leaves no round, so the page offers Retry.
  async start(contractId: string): Promise<void> {
    try {
      await this.startRound(contractId);
    } catch (err) {
      this.logger.error(`Starting signing for ${contractId} failed: ${(err as Error).message}`);
    }
    this.events.publish(contractId, 'contract');
  }

  // Retry either step that can fail: making the document to sign, or the signed copy.
  async retry(user: User, contractId: string): Promise<void> {
    await this.contracts.partyOf(user, contractId);
    const round = await this.pending(contractId);
    if (round) await this.finishIfSigned(round);
    else await this.startRound(contractId);
    this.events.publish(contractId, 'contract');
  }

  private async startRound(contractId: string): Promise<void> {
    const contract = await this.prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { parties: { include: { signer: true, participants: true } } },
    });
    if (contract.status !== ContractStatus.READY_TO_SIGN || (await this.pending(contractId))) return;
    const missing = contract.parties.find((party) => !party.signer);
    if (missing) {
      throw new ConflictException(`${missing.orgName} needs to choose who signs (People).`);
    }
    const version = await this.prisma.contractVersion.findFirstOrThrow({ where: { contractId }, orderBy: { versionNumber: 'desc' } });
    const { file } = await this.editor.render(contract.draftContent, contract.title, 'pdf', this.signingLayout(contract));
    const round = await this.prisma.signingRequest.create({
      data: { contractId, versionId: version.id, provider: 'internal', status: 'PENDING', unsignedHash: sha256(file) },
    });
    const key = `signing/${contractId}/${round.id}-unsigned.pdf`;
    await this.editor.storeFile(key, file, 'application/pdf');
    await this.prisma.signingRequest.update({ where: { id: round.id }, data: { unsignedFileKey: key } });

    // Signing happens on the contract page, so a signer who hasn't joined gets a link that signs them in.
    const appUrl = this.config.get('appUrl', { infer: true });
    for (const party of contract.parties) {
      if (party.participants.some((p) => p.userId === party.signerUserId)) continue;
      const invite = await this.prisma.invite.findFirst({ where: { partyId: party.id, email: party.signer!.email, acceptedAt: null } });
      if (!invite) continue;
      const token = randomBytes(32).toString('base64url');
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      try {
        await this.mail.send(signInToSignEmail(invite.email, party.orgName, contract.title, `${appUrl}/invite/${token}`));
      } catch (err) {
        this.logger.error(`Email to ${invite.email} failed: ${(err as Error).message}`);
      }
    }
  }

  // The document being signed in the current round, for anyone on the contract to read.
  async documentToSign(user: User, contractId: string): Promise<{ file: Buffer; filename: string }> {
    await this.contracts.partyOf(user, contractId);
    const round = await this.pending(contractId);
    if (!round?.unsignedFileKey) {
      throw new NotFoundException('There is nothing to sign right now.');
    }
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    return { file: await this.editor.readFile(round.unsignedFileKey), filename: fileName(`${contract.title} - to sign`, 'pdf') };
  }

  async sign(user: User, contractId: string, input: SignInput): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const round = await this.pending(contractId);
    if (!round?.unsignedFileKey || !round.unsignedHash) {
      throw new ConflictException('There is nothing to sign right now.');
    }
    if (party.signerUserId !== user.id) {
      throw new ForbiddenException(`Only the person chosen to sign for ${party.orgName} can sign.`);
    }
    if (party.signedAt) {
      throw new ConflictException(`${party.orgName} has already signed.`);
    }
    const imageKey = `signing/${contractId}/${round.id}-${party.role.toLowerCase()}.png`;
    await this.editor.storeFile(imageKey, input.image, 'image/png');
    await this.prisma.$transaction(async (tx) => {
      // Conditional, so a double click or a Reopen at the same moment can't record a second signature.
      const marked = await tx.contractParty.updateMany({ where: { id: party.id, signedAt: null }, data: { signedAt: new Date() } });
      const live = await tx.signingRequest.count({ where: { id: round.id, status: 'PENDING' } });
      if (marked.count === 0 || live === 0) {
        throw new ConflictException('This signing has changed. Reload the page.');
      }
      await tx.signature.create({
        data: {
          requestId: round.id,
          partyId: party.id,
          userId: user.id,
          method: input.method,
          imageKey,
          ip: input.ip,
          userAgent: input.userAgent?.slice(0, 300),
          documentHash: round.unsignedHash!,
        },
      });
      await tx.activityLog.create({ data: { contractId, actorUserId: user.id, type: 'SIGNED_BY_SIDE', payload: { partyId: party.id } } });
    });
    this.events.publish(contractId, 'contract');
    try {
      await this.finishIfSigned(round);
    } catch (err) {
      // The signature is recorded; the page offers Retry to make the signed copy.
      this.logger.error(`Finishing signing for ${contractId} failed: ${(err as Error).message}`);
    }
  }

  // A side changes its signer until it has signed.
  async setSigner(user: User, contractId: string, signerUserId: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    if (party.signedAt) {
      throw new ForbiddenException(`${party.orgName} has already signed.`);
    }
    await this.contracts.setSigner(user, contractId, signerUserId);
    // Signing may have been waiting for this side to choose a signer.
    if (!(await this.pending(contractId))) await this.start(contractId);
  }

  // Reopen also ends the signing round: before anyone signs either side may; after one side has
  // signed, only the side still to sign (which is also how a signer declines).
  async reopen(user: User, contractId: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    if (party.signedAt) {
      throw new ForbiddenException(`${party.orgName} has signed, so only the other side can reopen now.`);
    }
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: { parties: true } });
    if (contract.status !== ContractStatus.READY_TO_SIGN) {
      throw new ConflictException('Only a contract that is ready to sign can be reopened.');
    }
    await this.prisma.signingRequest.updateMany({ where: { contractId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    const signedOther = contract.parties.find((p) => p.id !== party.id && p.signedAt);
    await this.editor.reopen(user, contractId, signedOther?.orgName);
  }

  async signedFile(user: User, contractId: string): Promise<{ file: Buffer; filename: string }> {
    await this.contracts.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const round = await this.prisma.signingRequest.findFirst({ where: { contractId, status: 'COMPLETED' } });
    if (!round?.signedFileKey) {
      throw new NotFoundException('This contract has not been signed yet.');
    }
    return { file: await this.editor.readFile(round.signedFileKey), filename: fileName(`${contract.title} - signed`, 'pdf') };
  }

  // Once both sides have signed: the signed copy with the signatures and the audit page, then Signed.
  private async finishIfSigned(round: SigningRequest): Promise<void> {
    const contract = await this.prisma.contract.findUniqueOrThrow({
      where: { id: round.contractId },
      include: { parties: true },
    });
    const signatures = await this.prisma.signature.findMany({
      where: { requestId: round.id },
      include: { user: true, party: true },
      orderBy: { signedAt: 'asc' },
    });
    if (signatures.length < contract.parties.length) return;

    const images = await Promise.all(signatures.map((s) => this.editor.readFile(s.imageKey)));
    const { file } = await this.editor.render(contract.draftContent, contract.title, 'pdf', {
      ...this.signingLayout(contract),
      signatures: Object.fromEntries(
        signatures.map((s, i) => [s.party.role, { image: images[i].toString('base64'), date: day(s.signedAt) }]),
      ) as Record<PartyRole, { image: string; date: string }>,
      audit: {
        headers: ['Side', 'Signed by', 'Signed (UTC)', 'Signature', 'IP address'],
        rows: signatures.map((s) => [
          s.party.orgName,
          `${s.user.name ?? ''} <${s.user.email}>`.trim(),
          s.signedAt.toISOString().replace('T', ' ').slice(0, 19),
          METHOD_LABEL[s.method as SignatureMethod],
          s.ip ?? 'unknown',
        ]),
        notes: [
          ...signatures.map((s) => `Browser used by ${s.party.orgName}: ${s.userAgent ?? 'unknown'}`),
          `Document signed (SHA-256 fingerprint of the unsigned copy): ${round.unsignedHash}`,
          'Each signer confirmed their email address with a one-time code when signing in, and agreed that the signature is theirs and that they sign for their organisation.',
          'The fingerprint of this signed copy is kept by the platform, so any later change to the file can be detected.',
        ],
      },
    });
    const key = `signing/${round.contractId}/${round.id}-signed.pdf`;
    await this.editor.storeFile(key, file, 'application/pdf');

    const finished = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.signingRequest.updateMany({
        where: { id: round.id, status: 'PENDING' },
        data: { status: 'COMPLETED', signedFileKey: key, signedDocHash: sha256(file) },
      });
      if (claimed.count === 0) return false;
      await tx.contract.update({ where: { id: round.contractId }, data: { status: ContractStatus.SIGNED } });
      await tx.activityLog.create({ data: { contractId: round.contractId, actorUserId: signatures.at(-1)!.userId, type: 'SIGNED', payload: {} } });
      return true;
    });
    if (!finished) return;
    this.events.publish(round.contractId, 'contract');
    const link = `${this.config.get('appUrl', { infer: true })}/contracts/${round.contractId}`;
    await this.editor.emailBothSides(round.contractId, (email) => signedEmail(email, contract.title, link));
  }

  private signingLayout(contract: { signaturePlacement: 'SPOTS' | 'PAGE' | null; parties: { role: PartyRole; orgName: string }[] }) {
    const orgOf = (role: PartyRole) => contract.parties.find((party) => party.role === role)!.orgName;
    return {
      placement: contract.signaturePlacement ?? 'PAGE',
      orgs: { PROPOSER: orgOf(PartyRole.PROPOSER), COUNTERPARTY: orgOf(PartyRole.COUNTERPARTY) },
    };
  }

  private pending(contractId: string): Promise<SigningRequest | null> {
    return this.prisma.signingRequest.findFirst({ where: { contractId, status: 'PENDING' } });
  }
}

// Signature images arrive as PNG data URLs from the Sign window (drawn, typed or uploaded, all
// turned into a PNG there).
export function parseSignatureImage(value: unknown): Buffer {
  const match = typeof value === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value) : null;
  const image = match ? Buffer.from(match[1], 'base64') : null;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!image || image.length > 1024 * 1024 || !image.subarray(0, 8).equals(png)) {
    throw new BadRequestException('The signature must be a PNG image under 1 MB.');
  }
  return image;
}
