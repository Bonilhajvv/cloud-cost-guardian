import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { MANUAL_ENVIRONMENTS } from '../../resource-inventory/constants/environment.constant';
import { ManualEnvironment } from '../../aws/core/interfaces/environment.interface';
import { MAX_NAMESPACE_ENVIRONMENT_BATCH } from '../constants/kubernetes-analysis.constant';

export class SetClusterEnvironmentDto {
  @ValidateIf((_, value) => value !== null)
  @IsIn(MANUAL_ENVIRONMENTS)
  environment: ManualEnvironment | null;
}

export class NamespaceEnvironmentDto extends SetClusterEnvironmentDto {
  @IsString()
  @MaxLength(253)
  namespace: string;
}

export class SetNamespaceEnvironmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_NAMESPACE_ENVIRONMENT_BATCH)
  @ValidateNested({ each: true })
  @Type(() => NamespaceEnvironmentDto)
  items: NamespaceEnvironmentDto[];
}
