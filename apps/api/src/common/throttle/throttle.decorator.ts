import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'videoplat:throttle';

export interface ThrottleOptions {
  /** Número máximo de requisições dentro da janela. */
  limit: number;
  /** Tamanho da janela em segundos. */
  windowSec: number;
}

/**
 * Limita quantas vezes um handler pode ser chamado por IP dentro de uma
 * janela. O contador fica no Redis, então funciona com múltiplas réplicas
 * da API.
 */
export const Throttle = (options: ThrottleOptions) =>
  SetMetadata(THROTTLE_KEY, options);
