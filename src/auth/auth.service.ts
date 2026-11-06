import * as bcrypt from 'bcryptjs';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, Role } from '../common/enums';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { EnvironmentVariables } from '../config/env.validation';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';
import { TokenResponseDto } from './dto/token-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PrincipalService } from './principal.service';

const INVALID_CREDENTIALS = 'Invalid credentials';
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7YH1kG7E8m8mUZb0Yb1dO9Q0eXoQx7e';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly users: UsersService,
    private readonly organizations: OrganizationsService,
    private readonly principals: PrincipalService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenResponseDto> {
    const principal = await this.dataSource.transaction(async (manager) => {
      const org = await this.organizations.create(dto.organizationName, manager);
      const user = await this.users.create(
        { email: dto.email, name: dto.name, password: dto.password },
        manager,
      );
      await this.users.addMembership(org.id, user.id, Role.ORG_ADMIN, manager);
      return { userId: user.id, email: user.email, role: Role.ORG_ADMIN, organizationId: org.id };
    });
    this.logger.log({ msg: 'Organization registered', organizationId: principal.organizationId, userId: principal.userId });
    return this.issueTokens(principal);
  }

  async login(dto: LoginDto, ip: string | null): Promise<TokenResponseDto> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid || !user.isActive) {
      this.logger.warn({ msg: 'Login failed', reason: 'invalid_credentials', ip });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    let organizationId = dto.organizationId ?? null;
    if (!organizationId && user.platformRole !== Role.SUPER_ADMIN) {
      organizationId = await this.principals.defaultOrganizationId(user.id);
    }
    const principal = await this.principals.resolve(user.id, organizationId);
    if (!principal) {
      this.logger.warn({ msg: 'Login failed', reason: 'no_active_membership', userId: user.id, organizationId, ip });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.users.markLogin(user.id);
    await this.audit.log({
      action: AuditAction.USER_LOGIN,
      organizationId: principal.organizationId,
      userId: user.id,
      ip,
    });
    this.logger.log({ msg: 'Login succeeded', userId: user.id, organizationId: principal.organizationId, role: principal.role });
    return this.issueTokens(principal);
  }

  async refresh(dto: RefreshTokenDto): Promise<TokenResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(dto.refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Invalid refresh token');
    const principal = await this.principals.resolve(payload.sub, payload.org);
    if (!principal) throw new UnauthorizedException('Session no longer valid');
    return this.issueTokens(principal);
  }

  private async issueTokens(user: RequestUser): Promise<TokenResponseDto> {
    const base = { sub: user.userId, email: user.email, role: user.role, org: user.organizationId };
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ ...base, typ: 'access' } satisfies JwtPayload, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessTtl as never,
      }),
      this.jwt.signAsync({ ...base, typ: 'refresh' } satisfies JwtPayload, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }) as never,
      }),
    ]);
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: accessTtl, user };
  }
}
