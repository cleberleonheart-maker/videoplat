import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Cursor keyset (createdAt+id) em vez de offset: não pula nem duplica
 * itens quando o feed muda entre páginas.
 */
export const Cursor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.query?.cursor as string | undefined;
  },
);
