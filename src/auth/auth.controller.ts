import { Body, Controller, Get, HttpCode, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser, Public, SkipTenant } from '../common/decorators';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { AuthService } from './auth.service';
import { AuthPrincipalDto, TokenResponseDto } from './dto/token-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('Auth')
@SkipTenant()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse()
  @Post('register')
  @ApiOkResponse({ type: TokenResponseDto })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponseDto })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse()
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponseDto })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthPrincipalDto })
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }
}
