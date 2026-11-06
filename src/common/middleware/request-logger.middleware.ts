import { randomUUID } from 'crypto';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { LOG_SKIP_PATHS } from '../constants/logging.constant';
import { RequestUser } from '../interfaces/request-user.interface';
import { redact } from '../helpers/redact.helper';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request & { user?: RequestUser; requestId?: string }, res: Response, next: NextFunction): void {
    if (LOG_SKIP_PATHS.includes(req.originalUrl.split('?')[0])) return next();

    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const startedAt = process.hrtime.bigint();

    this.logger.log({
      msg: 'request',
      requestId,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    this.logger.debug({
      msg: 'request body',
      requestId,
      query: redact(req.query),
      body: redact(req.body),
    });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const entry = {
        msg: 'response',
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        contentLength: res.getHeader('content-length') ?? null,
        userId: req.user?.userId ?? null,
        organizationId: req.user?.organizationId ?? null,
        role: req.user?.role ?? null,
      };
      if (res.statusCode >= 500) this.logger.error(entry);
      else if (res.statusCode >= 400) this.logger.warn(entry);
      else this.logger.log(entry);
    });

    next();
  }
}
