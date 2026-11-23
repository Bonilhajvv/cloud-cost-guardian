import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_THROTTLE_LIMIT, AUTH_THROTTLE_TTL_MS } from './constants/auth.constant';

describe('AuthController rate limit', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT }])],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: { login: jest.fn().mockResolvedValue({ accessToken: 'x' }) } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/auth/login`;
  });

  afterAll(() => app.close());

  it(`answers 429 after ${AUTH_THROTTLE_LIMIT} logins per minute from the same IP`, async () => {
    const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@example.com","password":"x"}' });
    const statuses: number[] = [];
    for (let i = 0; i <= AUTH_THROTTLE_LIMIT; i++) statuses.push((await post()).status);

    expect(statuses.slice(0, AUTH_THROTTLE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses[AUTH_THROTTLE_LIMIT]).toBe(429);
  });
});
