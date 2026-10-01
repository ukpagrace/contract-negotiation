import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Req, StreamableFile, UseGuards } from '@nestjs/common';

import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { parseSignatureImage, SigningService, type SignatureMethod } from './signing.service.js';

const METHODS: SignatureMethod[] = ['DRAWN', 'TYPED', 'UPLOADED'];

@Controller('contracts/:id')
@UseGuards(SessionGuard)
export class SigningController {
  constructor(private readonly signing: SigningService) {}

  // Inline, so it opens in the browser to read before signing.
  @Get('signing/document')
  async document(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<StreamableFile> {
    const { file, filename } = await this.signing.documentToSign(request.user, id);
    return new StreamableFile(file, { type: 'application/pdf', disposition: `inline; filename="${filename}"` });
  }

  @Post('sign')
  @HttpCode(204)
  sign(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('image') image: unknown,
    @Body('method') method: unknown,
    @Body('agreed') agreed: unknown,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    if (agreed !== true) {
      throw new BadRequestException('Tick the box to confirm this is your signature.');
    }
    if (!METHODS.includes(method as SignatureMethod)) {
      throw new BadRequestException('method must be DRAWN, TYPED or UPLOADED.');
    }
    return this.signing.sign(request.user, id, { image: parseSignatureImage(image), method: method as SignatureMethod, ip: request.ip, userAgent });
  }

  @Post('signing/retry')
  @HttpCode(204)
  retry(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    return this.signing.retry(request.user, id);
  }

  @Get('signed-pdf')
  async signedPdf(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<StreamableFile> {
    const { file, filename } = await this.signing.signedFile(request.user, id);
    return new StreamableFile(file, { type: 'application/pdf', disposition: `attachment; filename="${filename}"` });
  }
}
