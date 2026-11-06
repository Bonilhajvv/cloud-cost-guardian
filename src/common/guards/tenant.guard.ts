import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../decorators';
import { RequestUser } from '../interfaces/request-user.interface';

const UUID_PARAM_KEYS = ['organizationId', 'orgId'];

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<{
      user?: RequestUser;
      params?: Record<string, string>;
      query?: Record<string, unknown>;
    }>();
    const user = request.user;
    if (!user?.organizationId) {
      throw new ForbiddenException('Organization context required');
    }

    for (const key of UUID_PARAM_KEYS) {
      const fromParams = request.params?.[key];
      const fromQuery = request.query?.[key];
      for (const value of [fromParams, fromQuery]) {
        if (value !== undefined && value !== user.organizationId) {
          throw new ForbiddenException('Cross-tenant access denied');
        }
      }
    }
    return true;
  }
}
