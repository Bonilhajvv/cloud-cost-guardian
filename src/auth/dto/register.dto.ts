import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(2, 160)
  organizationName: string;

  @IsString()
  @Length(2, 120)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
