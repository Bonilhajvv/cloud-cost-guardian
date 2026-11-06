import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { EnvironmentVariables } from '../../config/env.validation';
import { PrincipalService } from '../principal.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly principals: PrincipalService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (payload.typ !== 'access') throw new UnauthorizedException();
    const principal = await this.principals.resolve(payload.sub, payload.org);
    if (!principal) throw new UnauthorizedException('Session no longer valid');
    return principal;
  }
}
