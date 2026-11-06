import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ana@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Secret123!' })
  @IsString()
  password: string;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: 'Only for users in more than one organization. Omit to use the first membership.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string | null;
}
