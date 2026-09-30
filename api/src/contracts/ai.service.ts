import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AI_PROVIDER, type AiProvider, type AiRequest, type AiTurn } from '../ai/ai.provider.js';
import type { AppConfig } from '../config/configuration.js';
import type { User } from '../generated/prisma/client.js';
import { collectChanges, type DocNode } from './changes.js';
import { ContractsService } from './contracts.service.js';

const HOUR_MS = 60 * 60 * 1000;
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

const INSTRUCTIONS = (org: string) => `You help people who are negotiating a contract understand it. They are not lawyers, so use plain, everyday words and short sentences, and avoid legal jargon (explain a term if it can't be avoided).

The contract is below. Proposed changes that haven't been accepted yet are marked inline like [change 2, added by Acme: new text] and [change 3, removed by Beta: old text]. The person asking works for ${org}; "you" means them.

Be neutral and factual: explain what the text says and what it would mean in practice, without taking sides or telling them what to agree to. If the answer depends on the law or on facts not in the contract, say so briefly and suggest checking with their lawyer. Answer only from this contract; if it doesn't say, say that. Reply in plain text, using "- " for lists and no other formatting.`;

interface Readable {
  text: string;
  // Change id → its number in the text.
  numbers: Map<string, number>;
}

// The contract as text, with each pending change marked where it sits. Only the document goes
// in: never comments or chat, so nothing internal can reach the AI.
function readable(doc: DocNode | null, orgOf: (partyId: string) => string): Readable {
  const changes = collectChanges(doc);
  const numbers = new Map([...changes.keys()].map((id, i) => [id, i + 1]));
  const label = (id: string) => {
    const change = changes.get(id)!;
    return `change ${numbers.get(id)}, ${change.type === 'INSERT' ? 'added' : 'removed'} by ${orgOf(change.authorPartyId)}`;
  };

  const inline = (block: DocNode) => {
    let out = '';
    let open: string | null = null;
    for (const node of block.content ?? []) {
      const mark = node.marks?.find((m) => m.type === 'trackedInsertion' || m.type === 'trackedDeletion');
      const id = typeof mark?.attrs?.changeId === 'string' ? mark.attrs.changeId : null;
      if (id !== open) {
        if (open) out += ']';
        if (id) out += `[${label(id)}: `;
        open = id;
      }
      out += node.type === 'text' ? (node.text ?? '') : node.type === 'hardBreak' ? '\n' : '';
    }
    return open ? `${out}]` : out;
  };

  const lines = (node: DocNode): string[] => {
    if (TEXTBLOCKS.has(node.type)) {
      const level = Number(node.attrs?.level ?? 0);
      return [(node.type === 'heading' ? `${'#'.repeat(level || 1)} ` : '') + inline(node)];
    }
    if (node.type === 'tableRow') {
      return [`| ${(node.content ?? []).map((cell) => lines(cell).join(' ')).join(' | ')} |`];
    }
    const inner = (node.content ?? []).flatMap(lines);
    if (node.type === 'listItem' || node.type === 'taskItem') {
      return inner.map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`));
    }
    return inner;
  };

  return { text: doc ? lines(doc).join('\n') : '', numbers };
}

@Injectable()
export class AiService {
  // Recent request times per person. In memory, like the live updates: assumes one API process.
  private readonly recent = new Map<string, number[]>();

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly contracts: ContractsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async explainChange(user: User, contractId: string, changeId: string): Promise<string> {
    const { context, instructions, numbers } = await this.prepare(user, contractId);
    const number = numbers.get(changeId);
    if (!number) {
      throw new NotFoundException('That change is no longer pending. Reload and try again.');
    }
    const question = `Explain change ${number} in two to four short sentences: what it changes and what it would mean in practice. If it is one half of a replacement with the change just before or after it, explain the replacement as a whole.`;
    return this.ask(user, { instructions, context, turns: [{ role: 'user', content: question }], depth: 'quick' });
  }

  async summarize(user: User, contractId: string): Promise<string> {
    const { context, instructions } = await this.prepare(user, contractId);
    const question =
      'Summarise all the proposed changes that are still pending, grouped by topic and most important first. For each, say who proposed it and what it would mean in practice in a sentence or two. If there are none, say so.';
    return this.ask(user, { instructions, context, turns: [{ role: 'user', content: question }], depth: 'thorough' });
  }

  async chat(user: User, contractId: string, turns: AiTurn[]): Promise<string> {
    const { context, instructions } = await this.prepare(user, contractId);
    return this.ask(user, { instructions, context, turns, depth: 'quick' });
  }

  private async prepare(user: User, contractId: string) {
    const party = await this.contracts.partyOf(user, contractId);
    // What this person can see: the working draft on their turn, otherwise the last sent version.
    const contract = await this.contracts.get(user, contractId);
    const orgOf = (partyId: string) => contract.parties.find((p) => p.id === partyId)?.orgName ?? 'the other side';
    const { text, numbers } = readable(contract.draftContent as unknown as DocNode | null, orgOf);
    if (!text.trim()) {
      throw new NotFoundException("There's no document to ask about yet.");
    }
    return { instructions: INSTRUCTIONS(party.orgName), context: `Contract: ${contract.title}\n\n${text}`, numbers };
  }

  private async ask(user: User, request: AiRequest): Promise<string> {
    const now = Date.now();
    const times = (this.recent.get(user.id) ?? []).filter((t) => now - t < HOUR_MS);
    const max = this.config.get('ai', { infer: true }).maxPerHour;
    if (times.length >= max) {
      const minutes = Math.ceil((times[0] + HOUR_MS - now) / 60_000);
      throw new HttpException(`You've used your ${max} AI requests for this hour. Try again in ${minutes} minutes.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.recent.set(user.id, [...times, now]);
    return this.ai.answer(request);
  }
}
