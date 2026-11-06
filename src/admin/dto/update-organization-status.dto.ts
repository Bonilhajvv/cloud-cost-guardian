import { IsEnum } from 'class-validator';
import { OrganizationStatus } from '../../common/enums';

export class UpdateOrganizationStatusDto {
  @IsEnum(OrganizationStatus)
  status: OrganizationStatus;
}
