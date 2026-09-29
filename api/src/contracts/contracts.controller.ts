import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';

import { parseEmail } from '../auth/auth.controller.js';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import type { PartyRole } from '../generated/prisma/client.js';
import { ContractsService, type ContractDetail, type TeamMember } from './contracts.service.js';

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

@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Post('contracts')
  @UseGuards(SessionGuard)
  create(
    @Req() request: AuthenticatedRequest,
    @Body('title') title: unknown,
    @Body('proposerOrgName') proposerOrgName: unknown,
    @Body('counterpartyOrgName') counterpartyOrgName: unknown,
    @Body('counterpartyEmail') counterpartyEmail: unknown,
    @Body('team') team: unknown,
  ): Promise<ContractDetail> {
    if (team !== undefined && (!Array.isArray(team) || team.length > 20)) {
      throw new BadRequestException('team must be a list of up to 20 people.');
    }
    return this.contracts.create(request.user, {
      title: parseText(title, 'Title'),
      proposerOrgName: parseText(proposerOrgName, 'Proposing organisation name'),
      counterpartyOrgName: parseText(counterpartyOrgName, 'Counterparty organisation name'),
      counterpartyEmail: parseEmail(counterpartyEmail),
      team: ((team as unknown[] | undefined) ?? []).map(parseMember),
    });
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
}
