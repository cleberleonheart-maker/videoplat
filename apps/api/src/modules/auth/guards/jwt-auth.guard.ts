import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * Em rotas públicas o token ainda é processado quando presente, para que
   * @CurrentUser() tenha contexto, mas a ausência ou invalidez do token
   * não bloqueia a requisição.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isPublic) {
      const result = super.canActivate(context);
      return isObservable(result)
        ? firstValueFrom(result)
        : await (result as Promise<boolean> | boolean);
    }

    try {
      const result = super.canActivate(context);
      await (isObservable(result) ? firstValueFrom(result) : result);
    } catch {
      // Sem token ou token inválido em rota pública é esperado.
    }
    return true;
  }
}
