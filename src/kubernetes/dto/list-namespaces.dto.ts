import { IsIn, IsOptional } from 'class-validator';
import { ENVIRONMENT_FILTERS } from '../../resource-inventory/constants/environment.constant';

export class ListNamespacesDto {
  @IsOptional()
  @IsIn(ENVIRONMENT_FILTERS)
  environment?: (typeof ENVIRONMENT_FILTERS)[number];
}
