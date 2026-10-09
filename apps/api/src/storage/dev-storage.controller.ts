import { pipeline } from 'node:stream/promises';
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  PayloadTooLargeException,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { LinkTooLargeError, LocalStorage, parseRange } from './local.storage';
import { STORAGE, StorageError, type StoragePort } from './storage.port';

// Token-authorised stand-ins for R2's temporary links. They only exist while the storage in use is the local
// driver; with any other driver every route answers 404. They are public (no sign-in) because the signed,
// expiring token in the path is the credential, exactly like an R2 link.
@Public()
@SkipThrottle()
@Controller('dev-storage')
export class DevStorageController {
  constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

  @Put(':token')
  async put(@Req() req: Request, @Res() res: Response): Promise<void> {
    const local = this.local();
    const link = local.verify(String(req.params.token));
    if (!link || link.op === 'get') throw new ForbiddenException('This link is invalid or has expired.');
    try {
      if (link.op === 'part') {
        res.setHeader('ETag', await local.acceptPart(link, req));
      } else {
        if (req.headers['content-type'] !== link.contentType) throw new ForbiddenException('This link is invalid or has expired.');
        await local.acceptObject(link, req);
      }
    } catch (error) {
      if (error instanceof LinkTooLargeError) throw new PayloadTooLargeException('That file is too large for this link.');
      if (error instanceof StorageError) throw new NotFoundException('That upload does not exist.');
      throw error;
    }
    res.status(200).end();
  }

  @Get(':token')
  async read(@Req() req: Request, @Res() res: Response): Promise<void> {
    const local = this.local();
    const link = local.verify(String(req.params.token));
    if (!link || link.op !== 'get') throw new ForbiddenException('This link is invalid or has expired.');
    const info = await local.head(link.key);
    if (!info) throw new NotFoundException('Not found.');
    const range = parseRange(req.headers.range, info.size);
    if (range === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${info.size}`).end();
      return;
    }
    let opened;
    try {
      opened = await local.openObject(link.key, range);
    } catch (error) {
      if (error instanceof StorageError) throw new NotFoundException('Not found.');
      throw error;
    }
    res.status(range ? 206 : 200);
    res.setHeader('Content-Type', link.contentType);
    res.setHeader('Content-Length', String(opened.end - opened.start + 1));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    if (range) res.setHeader('Content-Range', `bytes ${opened.start}-${opened.end}/${opened.size}`);
    try {
      await pipeline(opened.stream, res);
    } catch (error) {
      // A viewer who closes the tab or seeks away aborts the transfer; pipeline has already closed the file. Once
      // the headers are out there is nobody left to answer, so only an earlier failure is passed on.
      if ((error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE' || res.headersSent) return;
      throw error;
    }
  }

  private local(): LocalStorage {
    if (!(this.storage instanceof LocalStorage)) throw new NotFoundException();
    return this.storage;
  }
}
