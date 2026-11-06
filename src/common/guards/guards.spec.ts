import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY, SKIP_TENANT_KEY } from '../decorators';
import { ORG_READ_ROLES, Role } from '../enums';
import { RequestUser } from '../interfaces/request-user.interface';
import { RolesGuard } from './roles.guard';
import { TenantGuard } from './tenant.guard';

const ORG_A = '4b0d89f3-1001-4ff4-8c78-86198b13dd77';
const ORG_B = 'eb456ae8-2e80-4768-a409-125809d97c39';

function context(
  user: RequestUser | undefined,
  metadata: Record<string, unknown> = {},
  req: { params?: Record<string, string>; query?: Record<string, unknown> } = {},
): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => metadata[key as string]);
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user, params: req.params ?? {}, query: req.query ?? {} }) }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

const user = (role: Role, organizationId: string | null = ORG_A): RequestUser => ({
  userId: 'u1',
  email: 'u@acme.com',
  role,
  organizationId,
});

describe('RolesGuard', () => {
  it('allows routes without @Roles', () => {
    const { ctx, reflector } = context(user(Role.VIEWER));
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('allows a listed role', () => {
    const { ctx, reflector } = context(user(Role.ORG_ADMIN), { [ROLES_KEY]: [Role.ORG_ADMIN] });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it.each([Role.ORG_MEMBER, Role.VIEWER])('blocks %s on ORG_ADMIN routes', (role) => {
    const { ctx, reflector } = context(user(role), { [ROLES_KEY]: [Role.ORG_ADMIN] });
    expect(() => new RolesGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('blocks ORG_ADMIN on SUPER_ADMIN routes', () => {
    const { ctx, reflector } = context(user(Role.ORG_ADMIN), { [ROLES_KEY]: [Role.SUPER_ADMIN] });
    expect(() => new RolesGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('blocks SUPER_ADMIN on org read routes (platform admins use /admin)', () => {
    const { ctx, reflector } = context(user(Role.SUPER_ADMIN, null), { [ROLES_KEY]: [...ORG_READ_ROLES] });
    expect(() => new RolesGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('skips public routes', () => {
    const { ctx, reflector } = context(undefined, { [IS_PUBLIC_KEY]: true, [ROLES_KEY]: [Role.ORG_ADMIN] });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });
});

describe('TenantGuard', () => {
  it('requires an organization context', () => {
    const { ctx, reflector } = context(user(Role.SUPER_ADMIN, null));
    expect(() => new TenantGuard(reflector).canActivate(ctx)).toThrow('Organization context required');
  });

  it('allows a user inside its own organization', () => {
    const { ctx, reflector } = context(user(Role.VIEWER), {}, { params: { organizationId: ORG_A } });
    expect(new TenantGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('blocks a route param pointing to another organization', () => {
    const { ctx, reflector } = context(user(Role.ORG_ADMIN), {}, { params: { organizationId: ORG_B } });
    expect(() => new TenantGuard(reflector).canActivate(ctx)).toThrow('Cross-tenant access denied');
  });

  it('blocks a query param pointing to another organization', () => {
    const { ctx, reflector } = context(user(Role.ORG_ADMIN), {}, { query: { organizationId: ORG_B } });
    expect(() => new TenantGuard(reflector).canActivate(ctx)).toThrow('Cross-tenant access denied');
  });

  it('lets @SkipTenant routes through (auth, admin)', () => {
    const { ctx, reflector } = context(user(Role.SUPER_ADMIN, null), { [SKIP_TENANT_KEY]: true });
    expect(new TenantGuard(reflector).canActivate(ctx)).toBe(true);
  });
});
