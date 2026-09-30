import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { parseEmail } from '../auth/auth.controller.js';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import type { PartyRole, Prisma } from '../generated/prisma/client.js';
import { ContractsService, type ContractDetail, type TeamMember } from './contracts.service.js';
import { EditorService, type LockHolder } from './editor.service.js';

const docxUpload = FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } });

function parseText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0 || text.length > 200) {
    throw new BadRequestException(`${field} must be 1–200 characters.`);
  }
  return text;
}

function parseMember(value: unknown): TeamMember {
  if (typeof value !== 'object' || value === null) {
    throw new BadRequestException('Each team member needs an email.');
  }
  const { email, name } = value as { email?: unknown; name?: unknown };
  return {
    email: parseEmail(email),
    name: name === undefined || name === '' ? undefined : parseText(name, 'Name'),
  };
}

function parseDocx(file: Express.Multer.File | undefined): Buffer {
  if (!file || !file.originalname.toLowerCase().endsWith('.docx')) {
    throw new BadRequestException('Upload a Word (.docx) file.');
  }
  return file.buffer;
}

@Controller()
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly editor: EditorService,
  ) {}

  // Accepts JSON, or multipart with an optional .docx `file` (then `team` is a JSON string and title is optional).
  @Post('contracts')
  @UseGuards(SessionGuard)
  @UseInterceptors(docxUpload)
  async create(
    @Req() request: AuthenticatedRequest,
    @Body('title') title: unknown,
    @Body('proposerOrgName') proposerOrgName: unknown,
    @Body('counterpartyOrgName') counterpartyOrgName: unknown,
    @Body('counterpartyEmail') counterpartyEmail: unknown,
    @Body('team') rawTeam: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ContractDetail & { commentsDropped: boolean }> {
    let team = rawTeam;
    if (typeof rawTeam === 'string') {
      try {
        team = JSON.parse(rawTeam);
      } catch {
        throw new BadRequestException('team must be a list of up to 20 people.');
      }
    }
    if (team !== undefined && (!Array.isArray(team) || team.length > 20)) {
      throw new BadRequestException('team must be a list of up to 20 people.');
    }
    const input = {
      proposerOrgName: parseText(proposerOrgName, 'Proposing organisation name'),
      counterpartyOrgName: parseText(counterpartyOrgName, 'Counterparty organisation name'),
      counterpartyEmail: parseEmail(counterpartyEmail),
      team: ((team as unknown[] | undefined) ?? []).map(parseMember),
    };

    if (!file) {
      const contract = await this.contracts.create(request.user, { ...input, title: parseText(title, 'Title') });
      return { ...contract, commentsDropped: false };
    }
    const imported = await this.editor.importDocx(parseDocx(file));
    const inferredTitle = (imported.title || file.originalname.replace(/\.docx$/i, '')).slice(0, 200);
    const contract = await this.contracts.create(request.user, {
      ...input,
      title: title ? parseText(title, 'Title') : inferredTitle,
      upload: { content: imported.content, s3Key: imported.s3Key },
    });
    return { ...contract, commentsDropped: imported.commentsDropped };
  }

  @Get('contracts')
  @UseGuards(SessionGuard)
  list(@Req() request: AuthenticatedRequest): ReturnType<ContractsService['list']> {
    return this.contracts.list(request.user);
  }

  @Get('contracts/:id')
  @UseGuards(SessionGuard)
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<ContractDetail> {
    return this.contracts.get(request.user, id);
  }

  @Post('contracts/:id/invites')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  invite(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.contracts.inviteTeammate(request.user, id, parseMember(body));
  }

  @Patch('contracts/:id/org-name')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  renameOrg(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body('orgName') orgName: unknown): Promise<void> {
    return this.contracts.renameOwnOrg(request.user, id, parseText(orgName, 'Organisation name'));
  }

  @Get('invites/:token')
  lookupInvite(@Param('token') token: string): Promise<{ email: string; contractTitle: string; role: PartyRole }> {
    return this.contracts.lookupInvite(token);
  }

  @Post('invites/:token/accept')
  @UseGuards(SessionGuard)
  acceptInvite(@Req() request: AuthenticatedRequest, @Param('token') token: string): Promise<{ contractId: string }> {
    return this.contracts.acceptInvite(request.user, token);
  }

  @Get('contracts/:id/lock')
  @UseGuards(SessionGuard)
  getLock(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<LockHolder | null> {
    return this.editor.getLock(request.user, id);
  }

  @Post('contracts/:id/lock')
  @UseGuards(SessionGuard)
  acquireLock(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('takeOver') takeOver: unknown,
  ): Promise<LockHolder> {
    return this.editor.acquireLock(request.user, id, takeOver === true);
  }

  @Delete('contracts/:id/lock')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  releaseLock(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    return this.editor.releaseLock(request.user, id);
  }

  @Put('contracts/:id/draft')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  saveDraft(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body('content') content: unknown): Promise<void> {
    const doc = content as { type?: unknown; content?: unknown } | null;
    if (typeof doc !== 'object' || doc === null || doc.type !== 'doc' || !Array.isArray(doc.content)) {
      throw new BadRequestException('content must be an editor document.');
    }
    return this.editor.saveDraft(request.user, id, content as Prisma.InputJsonObject);
  }

  @Post('contracts/:id/upload')
  @UseGuards(SessionGuard)
  @UseInterceptors(docxUpload)
  upload(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ content: Prisma.InputJsonObject; commentsDropped: boolean }> {
    return this.editor.replaceWithUpload(request.user, id, parseDocx(file));
  }

  @Post('contracts/:id/send')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  send(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    return this.editor.send(request.user, id);
  }

  @Get('contracts/:id/versions')
  @UseGuards(SessionGuard)
  listVersions(@Req() request: AuthenticatedRequest, @Param('id') id: string): ReturnType<ContractsService['listVersions']> {
    return this.contracts.listVersions(request.user, id);
  }

  @Get('contracts/:id/versions/:number')
  @UseGuards(SessionGuard)
  getVersion(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('number', ParseIntPipe) versionNumber: number,
  ): ReturnType<ContractsService['getVersion']> {
    return this.contracts.getVersion(request.user, id, versionNumber);
  }
}
