import { IsString, Length } from 'class-validator';

export class UpdateOrganizationDto {
  @IsString()
  @Length(2, 160)
  name: string;
}
