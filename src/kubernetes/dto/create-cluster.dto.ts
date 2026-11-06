import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateClusterDto {
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, { message: 'name may contain letters, numbers, dot, dash and underscore' })
  name: string;

  @IsOptional()
  @IsUUID()
  awsAccountId?: string;
}
