import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators';
import { Role } from '../enums';
import { RequestUser } from '../interfaces/request-user.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!roles || roles.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role for this operation');
    }
    return true;
  }
}
