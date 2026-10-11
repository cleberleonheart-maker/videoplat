import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { IO_REDIS } from '../queues/queue.module';
import { THROTTLE_KEY, ThrottleOptions } from './throttle.decorator';

@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IO_REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ThrottleOptions>(
      THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Sem @Throttle o guard é inerte: só protege as rotas marcadas.
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const ip =
      request.ip ||
      request.socket?.remoteAddress ||
      request.connection?.remoteAddress ||
      'unknown';
    const route = request.route?.path ?? request.url;
    const key = `throttle:${request.method}:${route}:${ip}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, options.windowSec);
      if (count > options.limit) {
        throw new HttpException(
          'Muitas tentativas. Aguarde um instante e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      // O rate limit é best-effort: se o Redis estiver fora, não derruba
      // a API — só deixa de limitar temporariamente.
      if (error instanceof HttpException) throw error;
    }
    return true;
  }
}
