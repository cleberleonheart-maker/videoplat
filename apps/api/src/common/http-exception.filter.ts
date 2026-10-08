import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { randomUUID } from 'crypto';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  requestId: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    const requestId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        message = (p.message as string) ?? exception.message;
        error = (p.error as string) ?? exception.name;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        error = 'Conflict';
        message = 'Resource already exists';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        error = 'Not Found';
        message = 'Resource not found';
      } else {
        this.logger.error(`Prisma ${exception.code}`, exception.stack);
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled ${exception.name}: ${exception.message}`,
        exception.stack,
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      requestId,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }
}
