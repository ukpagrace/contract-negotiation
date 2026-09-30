import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { ThreadStatus, Visibility, type Comment, type ContractParty, type Prisma, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { collectChanges, plainText, type DocNode } from './changes.js';
import { ContractsService } from './contracts.service.js';
import { EventsService } from './events.service.js';

export interface NewThread {
  visibility: Visibility;
  body: string;
  changeId?: string;
  anchor?: { quote: string; prefix: string; suffix: string };
}

export interface CommentItem {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export interface ThreadItem {
  id: string;
  changeId: string | null;
  partyId: string;
  orgName: string;
  visibility: Visibility;
  status: ThreadStatus;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  comments: CommentItem[];
}

export interface ChatItem extends CommentItem {
  partyId: string;
  orgName: string;
  visibility: Visibility;
}

const author = { select: { name: true, email: true } } satisfies Prisma.UserDefaultArgs;

const threadInclude = {
  party: true,
  resolvedBy: author,
  comments: { include: { authorUser: author }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CommentThreadInclude;

const nameOf = (user: { name: string | null; email: string }) => user.name ?? user.email;

type Authored = Pick<Comment, 'id' | 'authorUserId' | 'body' | 'createdAt' | 'editedAt' | 'deletedAt'> & {
  authorUser: { name: string | null; email: string };
};

function toComment(row: Authored): CommentItem {
  return {
    id: row.id,
    authorUserId: row.authorUserId,
    authorName: nameOf(row.authorUser),
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
  };
}

// The one rule for comments and chat: shared items, plus the viewer's own side's internal ones.
const visibleTo = (party: ContractParty) => ({
  contractId: party.contractId,
  OR: [{ visibility: Visibility.SHARED }, { partyId: party.id }],
});

@Injectable()
export class DiscussionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly events: EventsService,
  ) {}

  async listThreads(user: User, contractId: string): Promise<ThreadItem[]> {
    const party = await this.contracts.partyOf(user, contractId);
    const rows = await this.prisma.commentThread.findMany({
      where: visibleTo(party),
      include: threadInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      changeId: row.changeId,
      partyId: row.partyId,
      orgName: row.party.orgName,
      visibility: row.visibility,
      status: row.status,
      quote: row.quote,
      prefix: row.prefix,
      suffix: row.suffix,
      resolvedByName: row.resolvedBy ? nameOf(row.resolvedBy) : null,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      comments: row.comments.map(toComment),
    }));
  }

  async createThread(user: User, contractId: string, input: NewThread): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const seen = (await this.contracts.get(user, contractId)).draftContent as unknown as DocNode | null;
    const shared = input.visibility === Visibility.SHARED;
    // A shared thread must only point at what the other side has been sent, or it would leak the draft.
    const sent = shared
      ? ((await this.prisma.contractVersion.findFirst({ where: { contractId }, orderBy: { versionNumber: 'desc' } }))
          ?.content as unknown as DocNode | undefined)
      : undefined;
    const notSentYet = "The other side can't see this yet. Comment internally, or send the contract first.";

    // Change threads keep only the quote (prefix and suffix null), which is how they stay
    // distinguishable from text threads once a withdrawn change clears their changeId.
    let anchor: { quote: string; prefix: string | null; suffix: string | null };
    if (input.changeId) {
      const change = collectChanges(seen).get(input.changeId);
      if (!change) {
        throw new BadRequestException('That change is no longer in the document. Reload and try again.');
      }
      if (shared && !(sent && collectChanges(sent).has(input.changeId))) {
        throw new BadRequestException(notSentYet);
      }
      // Kept so the thread still reads sensibly after the change is resolved or withdrawn.
      anchor = { quote: change.text, prefix: null, suffix: null };
    } else {
      const { quote, prefix, suffix } = input.anchor!;
      anchor = input.anchor!;
      if (!seen || !plainText(seen).includes(`${prefix}${quote}${suffix}`)) {
        throw new BadRequestException('That text is no longer in the document. Reload and try again.');
      }
      if (shared) {
        const sentText = sent ? plainText(sent) : '';
        if (!sentText.includes(quote)) {
          throw new BadRequestException(notSentYet);
        }
        // The surrounding words may be unsent edits; drop them rather than share them.
        if (!sentText.includes(`${prefix}${quote}${suffix}`)) {
          anchor = { quote, prefix: '', suffix: '' };
        }
      }
    }

    await this.prisma.commentThread.create({
      data: {
        contractId,
        changeId: input.changeId,
        partyId: party.id,
        visibility: input.visibility,
        ...anchor,
        comments: { create: { authorUserId: user.id, body: input.body } },
      },
    });
    this.publish(contractId, 'comments', party, input.visibility);
  }

  async reply(user: User, contractId: string, threadId: string, body: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const thread = await this.findThread(party, threadId);
    await this.prisma.comment.create({ data: { threadId, authorUserId: user.id, body } });
    this.publish(contractId, 'comments', party, thread.visibility);
  }

  async setThreadResolved(user: User, contractId: string, threadId: string, resolved: boolean): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const thread = await this.findThread(party, threadId);
    await this.prisma.commentThread.update({
      where: { id: threadId },
      data: resolved
        ? { status: ThreadStatus.RESOLVED, resolvedByUserId: user.id, resolvedAt: new Date() }
        : { status: ThreadStatus.OPEN, resolvedByUserId: null, resolvedAt: null },
    });
    this.publish(contractId, 'comments', party, thread.visibility);
  }

  // body null deletes: the text is erased but the entry stays, so replies still make sense.
  async editComment(user: User, contractId: string, commentId: string, body: string | null): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, authorUserId: user.id, deletedAt: null, thread: visibleTo(party) },
      include: { thread: true },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }
    await this.prisma.comment.update({
      where: { id: commentId },
      data: body === null ? { body: '', deletedAt: new Date() } : { body, editedAt: new Date() },
    });
    this.publish(contractId, 'comments', party, comment.thread.visibility);
  }

  async listChat(user: User, contractId: string): Promise<ChatItem[]> {
    const party = await this.contracts.partyOf(user, contractId);
    const rows = await this.prisma.chatMessage.findMany({
      where: visibleTo(party),
      include: { authorUser: author, party: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      ...toComment(row),
      partyId: row.partyId,
      orgName: row.party.orgName,
      visibility: row.visibility,
    }));
  }

  async postChat(user: User, contractId: string, visibility: Visibility, body: string): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    await this.prisma.chatMessage.create({ data: { contractId, authorUserId: user.id, partyId: party.id, visibility, body } });
    this.publish(contractId, 'chat', party, visibility);
  }

  async editChat(user: User, contractId: string, messageId: string, body: string | null): Promise<void> {
    const party = await this.contracts.partyOf(user, contractId);
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, contractId, authorUserId: user.id, deletedAt: null },
    });
    if (!message) {
      throw new NotFoundException('Message not found.');
    }
    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: body === null ? { body: '', deletedAt: new Date() } : { body, editedAt: new Date() },
    });
    this.publish(contractId, 'chat', party, message.visibility);
  }

  private async findThread(party: ContractParty, threadId: string) {
    const thread = await this.prisma.commentThread.findFirst({ where: { id: threadId, ...visibleTo(party) } });
    if (!thread) {
      throw new NotFoundException('Thread not found.');
    }
    return thread;
  }

  private publish(contractId: string, type: 'comments' | 'chat', party: ContractParty, visibility: Visibility): void {
    this.events.publish(contractId, type, visibility === Visibility.SHARED ? undefined : party.id);
  }
}
