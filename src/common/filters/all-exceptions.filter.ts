import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AwsIntegrationError } from '../../aws/core/errors/aws-integration.error';
import { ErrorBody } from '../interfaces/error-body.interface';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { status, message, error } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        { msg: 'Unhandled exception', path: request.url, method: request.method, status },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; message: string | string[]; error: string } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && res !== null && 'message' in res
          ? (res as { message: string | string[] }).message
          : exception.message;
      return { status: exception.getStatus(), message, error: exception.name };
    }
    if (exception instanceof AwsIntegrationError) {
      return { status: HttpStatus.BAD_GATEWAY, message: exception.message, error: exception.code };
    }
    if (exception instanceof QueryFailedError) {
      const code = (exception.driverError as { code?: string } | undefined)?.code;
      if (code === '23505') {
        return { status: HttpStatus.CONFLICT, message: 'Resource already exists', error: 'Conflict' };
      }
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'InternalServerError',
    };
  }
}
