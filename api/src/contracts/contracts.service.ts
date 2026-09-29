import { BadRequestException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { hashToken } from '../auth/auth.service.js';
import type { AppConfig } from '../config/configuration.js';
import { PartyRole, type ContractParty, type Prisma, type User } from '../generated/prisma/client.js';
import { MAIL_PROVIDER, type MailProvider } from '../mail/mail.provider.js';
import { inviteEmail } from '../mail/mail.templates.js';
import { PrismaService } from '../prisma.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TeamMember {
  email: string;
  name?: string;
}

export interface CreateContractInput {
  title: string;
  proposerOrgName: string;
  counterpartyOrgName: string;
  counterpartyEmail: string;
  team: TeamMember[];
  upload?: { content: Prisma.InputJsonValue; s3Key: string };
}

const contractDetail = {
  parties: {
    include: {
      participants: { include: { user: { select: { id: true, email: true, name: true } } } },
      invites: { where: { acceptedAt: null }, select: { id: true, email: true, expiresAt: true } },
    },
  },
} satisfies Prisma.ContractInclude;

export type ContractDetail = Prisma.ContractGetPayload<{ include: typeof contractDetail }>;

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(user: User, input: CreateContractInput): Promise<ContractDetail> {
    const emails = [input.counterpartyEmail, ...input.team.map((member) => member.email)];
    if (emails.includes(user.email) || new Set(emails).size !== emails.length) {
      throw new BadRequestException('Each invited email must be different and not your own.');
    }

    const invites: { email: string; token: string }[] = [];
    const contract = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          title: input.title,
          draftContent: input.upload?.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
          createdById: user.id,
          parties: {
            create: [
              { role: PartyRole.PROPOSER, orgName: input.proposerOrgName },
              { role: PartyRole.COUNTERPARTY, orgName: input.counterpartyOrgName },
            ],
          },
        },
        include: { parties: true },
      });
      const proposer = created.parties.find((party) => party.role === PartyRole.PROPOSER)!;
      const counterparty = created.parties.find((party) => party.role === PartyRole.COUNTERPARTY)!;

      await tx.contract.update({ where: { id: created.id }, data: { currentTurnPartyId: proposer.id } });
      await tx.participant.create({ data: { partyId: proposer.id, userId: user.id, joinedAt: new Date() } });
      if (input.upload) {
        await tx.uploadedFile.create({ data: { contractId: created.id, s3Key: input.upload.s3Key, uploadedById: user.id } });
      }

      for (const member of input.team) {
        if (member.name) {
          await tx.user.upsert({ where: { email: member.email }, create: member, update: {} });
        }
      }

      const targets = [
        { email: input.counterpartyEmail, partyId: counterparty.id },
        ...input.team.map((member) => ({ email: member.email, partyId: proposer.id })),
      ];
      for (const target of targets) {
        const token = randomBytes(32).toString('base64url');
        await tx.invite.create({
          data: {
            contractId: created.id,
            partyId: target.partyId,
            email: target.email,
            invitedById: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
        });
        invites.push({ email: target.email, token });
      }

      return tx.contract.findUniqueOrThrow({ where: { id: created.id }, include: contractDetail });
    });

    for (const invite of invites) {
      await this.sendInvite(user, contract.title, invite.email, invite.token);
    }
    return contract;
  }

  async list(user: User): Promise<{ id: string; title: string; status: string; updatedAt: Date }[]> {
    return this.prisma.contract.findMany({
      where: { parties: { some: { participants: { some: { userId: user.id } } } } },
      select: { id: true, title: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(user: User, contractId: string): Promise<ContractDetail> {
    const party = await this.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractDetail });
    // The working draft is private to the side whose turn it is; the other side sees what was last sent.
    if (contract.currentTurnPartyId !== party.id) {
      const lastSent = await this.prisma.contractVersion.findFirst({
        where: { contractId },
        orderBy: { versionNumber: 'desc' },
      });
      contract.draftContent = lastSent?.content ?? null;
    }
    return contract;
  }

  async inviteTeammate(user: User, contractId: string, member: TeamMember): Promise<void> {
    const party = await this.partyOf(user, contractId);
    const contract = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId } });

    // An email can only ever belong to one side of a contract.
    const conflict = await this.prisma.contractParty.findFirst({
      where: {
        contractId,
        OR: [
          { participants: { some: { user: { email: member.email } } } },
          { id: { not: party.id }, invites: { some: { email: member.email } } },
        ],
      },
    });
    if (conflict) {
      throw new ForbiddenException('That person is already on this contract.');
    }

    if (member.name) {
      await this.prisma.user.upsert({ where: { email: member.email }, create: member, update: {} });
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.invite.create({
      data: {
        contractId,
        partyId: party.id,
        email: member.email,
        invitedById: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    await this.sendInvite(user, contract.title, member.email, token);
  }

  async renameOwnOrg(user: User, contractId: string, orgName: string): Promise<void> {
    const party = await this.partyOf(user, contractId);
    if (party.role !== PartyRole.COUNTERPARTY) {
      throw new ForbiddenException('Only the counterparty can rename its organisation.');
    }
    await this.prisma.$transaction([
      this.prisma.contractParty.update({ where: { id: party.id }, data: { orgName } }),
      this.prisma.activityLog.create({
        data: {
          contractId,
          actorUserId: user.id,
          type: 'ORG_RENAMED',
          payload: { from: party.orgName, to: orgName },
        },
      }),
    ]);
  }

  async lookupInvite(token: string): Promise<{ email: string; contractTitle: string; role: PartyRole }> {
    const invite = await this.findInvite(token);
    return { email: invite.email, contractTitle: invite.contract.title, role: invite.party.role };
  }

  async acceptInvite(user: User, token: string): Promise<{ contractId: string }> {
    const invite = await this.findInvite(token);
    if (invite.email !== user.email) {
      throw new ForbiddenException(`This invite is for ${invite.email}. Switch accounts to open it.`);
    }
    await this.prisma.$transaction([
      this.prisma.participant.upsert({
        where: { partyId_userId: { partyId: invite.partyId, userId: user.id } },
        create: { partyId: invite.partyId, userId: user.id, invitedById: invite.invitedById, joinedAt: new Date() },
        update: {},
      }),
      this.prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: invite.acceptedAt ?? new Date() } }),
    ]);
    return { contractId: invite.contractId };
  }

  async partyOf(user: User, contractId: string): Promise<ContractParty> {
    const party = await this.prisma.contractParty.findFirst({
      where: { contractId, participants: { some: { userId: user.id } } },
    });
    // 404 rather than 403 so non-members can't tell the contract exists.
    if (!party) {
      throw new NotFoundException('Contract not found.');
    }
    return party;
  }

  private async findInvite(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { contract: true, party: true },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found.');
    }
    if (invite.expiresAt < new Date()) {
      throw new GoneException('This invite has expired. Ask for a new one.');
    }
    return invite;
  }

  private async sendInvite(inviter: User, contractTitle: string, email: string, token: string): Promise<void> {
    const link = `${this.config.get('appUrl', { infer: true })}/invite/${token}`;
    await this.mail.send(inviteEmail(email, inviter.name ?? inviter.email, contractTitle, link));
  }
}
