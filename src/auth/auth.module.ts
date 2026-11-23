import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationUser } from '../organizations/entities/organization-user.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_THROTTLE_LIMIT, AUTH_THROTTLE_TTL_MS } from './constants/auth.constant';
import { PrincipalService } from './principal.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT }]),
    TypeOrmModule.forFeature([User, OrganizationUser]),
    UsersModule,
    OrganizationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PrincipalService, JwtStrategy],
  exports: [PrincipalService],
})
export class AuthModule {}
