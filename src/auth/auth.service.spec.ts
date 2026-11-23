import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../common/enums';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';

const SECRETS: Record<string, string> = {
  JWT_ACCESS_SECRET: 'access-secret-for-tests-only-0123456789',
  JWT_REFRESH_SECRET: 'refresh-secret-for-tests-only-0123456789',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
};
const config = { get: (key: string) => SECRETS[key] };
const PASSWORD = 'correct horse battery';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const principalA = { userId: 'u-1', email: 'ana@example.com', role: Role.ORG_ADMIN, organizationId: ORG_A };

function build(user: Record<string, unknown> | null = { id: 'u-1', email: 'ana@example.com', passwordHash: bcrypt.hashSync(PASSWORD, 4), isActive: true, platformRole: null }) {
  const jwt = new JwtService();
  const users = { findByEmailWithPassword: jest.fn().mockResolvedValue(user), markLogin: jest.fn() };
  const principals = {
    defaultOrganizationId: jest.fn().mockResolvedValue(ORG_A),
    resolve: jest.fn(async (_userId: string, org: string | null) => (org === ORG_A ? principalA : null)),
  };
  const audit = { log: jest.fn() };
  const service = new AuthService({} as never, jwt, config as never, users as never, {} as never, principals as never, audit as never);
  return { service, jwt, users, principals, audit };
}

describe('AuthService.login', () => {
  it('issues access and refresh tokens bound to the default organization', async () => {
    const { service, jwt, users, audit } = build();

    const res = await service.login({ email: 'ana@example.com', password: PASSWORD }, '10.0.0.1');

    const access = jwt.verify(res.accessToken, { secret: SECRETS.JWT_ACCESS_SECRET });
    expect(access).toMatchObject({ sub: 'u-1', org: ORG_A, typ: 'access', role: Role.ORG_ADMIN });
    expect(jwt.verify(res.refreshToken, { secret: SECRETS.JWT_REFRESH_SECRET })).toMatchObject({ typ: 'refresh' });
    expect(users.markLogin).toHaveBeenCalledWith('u-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, ip: '10.0.0.1' }));
  });

  it.each([
    ['wrong password', undefined, 'wrong'],
    ['unknown email', null, PASSWORD],
    ['inactive user', { id: 'u-1', passwordHash: bcrypt.hashSync(PASSWORD, 4), isActive: false }, PASSWORD],
  ])('rejects %s with the same message', async (_case, user, password) => {
    const { service, users, audit } = build(user as never);

    await expect(service.login({ email: 'ana@example.com', password }, null)).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    expect(users.markLogin).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects a login into an organization the user does not belong to', async () => {
    const { service, users } = build();

    await expect(service.login({ email: 'ana@example.com', password: PASSWORD, organizationId: ORG_B }, null)).rejects.toThrow(UnauthorizedException);
    expect(users.markLogin).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rotates tokens for a valid refresh token', async () => {
    const { service } = build();
    const { refreshToken } = await service.login({ email: 'ana@example.com', password: PASSWORD }, null);

    await expect(service.refresh({ refreshToken })).resolves.toMatchObject({ user: principalA });
  });

  it('rejects an access token used as refresh token', async () => {
    const { service } = build();
    const { accessToken } = await service.login({ email: 'ana@example.com', password: PASSWORD }, null);

    await expect(service.refresh({ refreshToken: accessToken })).rejects.toThrow('Invalid refresh token');
  });

  it('rejects a token signed with the refresh secret but typed as access', async () => {
    const { service, jwt } = build();
    const forged = jwt.sign({ sub: 'u-1', org: ORG_A, typ: 'access' }, { secret: SECRETS.JWT_REFRESH_SECRET });

    await expect(service.refresh({ refreshToken: forged })).rejects.toThrow('Invalid refresh token');
  });

  it('rejects a refresh after the membership is gone', async () => {
    const { service, jwt } = build();
    const orphan = jwt.sign({ sub: 'u-1', org: ORG_B, typ: 'refresh' }, { secret: SECRETS.JWT_REFRESH_SECRET });

    await expect(service.refresh({ refreshToken: orphan })).rejects.toThrow('Session no longer valid');
  });
});

describe('JwtStrategy', () => {
  const principals = { resolve: jest.fn(async (_u: string, org: string | null) => (org === ORG_A ? principalA : null)) };
  const strategy = new JwtStrategy(config as never, principals as never);

  it('accepts only access tokens', async () => {
    await expect(strategy.validate({ sub: 'u-1', org: ORG_A, typ: 'refresh' } as never)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ sub: 'u-1', org: ORG_A, typ: 'access' } as never)).resolves.toEqual(principalA);
  });

  it('rejects a token whose organization the user left', async () => {
    await expect(strategy.validate({ sub: 'u-1', org: ORG_B, typ: 'access' } as never)).rejects.toThrow('Session no longer valid');
  });
});
