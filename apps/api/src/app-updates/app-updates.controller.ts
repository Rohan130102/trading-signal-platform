import { randomBytes } from 'node:crypto';
import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, notFound, Public, Summary } from '../common/http.js';
import { AppUpdatesService, BadUpdateRequest } from './app-updates.service.js';

/** Where the native app looks for new versions of its screens. Public: the same code is inside every APK. */
@Controller('app-updates')
@Public()
export class AppUpdatesController {
  constructor(private readonly updates: AppUpdatesService) {}

  @Get('manifest')
  @Summary('Update check for the native app (Expo Updates protocol 1). 204 when there is nothing new.')
  async manifest(
    @Headers('expo-platform') platform: string | undefined,
    @Headers('expo-runtime-version') runtimeVersion: string | undefined,
    @Headers('expo-current-update-id') currentUpdateId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    let part;
    try {
      part = await this.updates.check(platform ?? '', runtimeVersion ?? '', currentUpdateId ?? null);
    } catch (error) {
      if (error instanceof BadUpdateRequest) throw new AppError(400, 'BAD_UPDATE_REQUEST', error.message);
      throw error;
    }
    res.setHeader('expo-protocol-version', '1');
    res.setHeader('expo-sfv-version', '0');
    res.setHeader('Cache-Control', 'private, max-age=0');
    if (!part) {
      res.status(204).end();
      return;
    }
    const boundary = `signaldesk-${randomBytes(12).toString('hex')}`;
    const body = [
      `--${boundary}`,
      'content-type: application/json; charset=utf-8',
      `content-disposition: form-data; name="${part.name}"`,
      `expo-signature: ${part.signature}`,
      '',
      part.body,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    res.setHeader('Content-Type', `multipart/mixed; boundary=${boundary}`);
    res.status(200).end(Buffer.from(body, 'utf8'));
  }

  @Get('files/:platform/:runtime/:update/:key')
  @Summary('One file of a published update. Its hash is in the signed manifest, and the app checks it.')
  async file(
    @Param('platform') platform: string,
    @Param('runtime') runtimeVersion: string,
    @Param('update') update: string,
    @Param('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.updates.file(platform, runtimeVersion, update, key);
    if (!file) throw notFound();
    res.setHeader('Content-Type', file.contentType);
    // Named by the hash of its content, so it never changes.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    await new Promise<void>((done, fail) =>
      res.sendFile(file.path, { dotfiles: 'deny', headers: { 'Content-Type': file.contentType } }, (error) =>
        error ? fail(error) : done(),
      ),
    );
  }
}
