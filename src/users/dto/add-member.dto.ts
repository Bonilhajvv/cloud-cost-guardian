import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { OrgRole, Role } from '../../common/enums';

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({ enum: [Role.ORG_ADMIN, Role.ORG_MEMBER, Role.VIEWER] })
  @IsIn([Role.ORG_ADMIN, Role.ORG_MEMBER, Role.VIEWER])
  role: OrgRole;
}

