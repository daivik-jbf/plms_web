import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import type { AppLogger } from './app-logger';
import { currentRequestMeta } from './request-context';

const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Invalid request.',
  413: 'Request body too large.',
  415: 'Unsupported content type.',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { requestId } = currentRequestMeta();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      res.status(status).json({ ...payload, statusCode: status, requestId });
      return;
    }

    const status = (exception as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({
        statusCode: status,
        error: 'Bad Request',
        message: CLIENT_ERROR_MESSAGES[status] ?? CLIENT_ERROR_MESSAGES[400],
        requestId,
      });
      return;
    }

    this.logger.error(
      `Unhandled error (${requestId}): ${exception instanceof Error ? exception.message : String(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    res.status(500).json({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again.',
      requestId,
    });
  }
}
