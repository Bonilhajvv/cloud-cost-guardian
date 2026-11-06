import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums';

export class AuthPrincipalDto {
  @ApiProperty() userId: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty({ nullable: true, type: String }) organizationId: string | null;
}

export class TokenResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty() tokenType: 'Bearer';
  @ApiProperty() expiresIn: string;
  @ApiProperty({ type: AuthPrincipalDto }) user: AuthPrincipalDto;
}
