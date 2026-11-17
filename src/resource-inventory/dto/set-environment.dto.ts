import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID, ValidateIf, ValidateNested } from 'class-validator';
import { MAX_ENVIRONMENT_BATCH, MANUAL_ENVIRONMENTS } from '../constants/environment.constant';

export class SetEnvironmentDto {
  @ValidateIf((_, value) => value !== null)
  @IsIn(MANUAL_ENVIRONMENTS)
  environment: (typeof MANUAL_ENVIRONMENTS)[number] | null;
}

export class ResourceEnvironmentDto extends SetEnvironmentDto {
  @IsUUID()
  id: string;
}

export class SetEnvironmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ENVIRONMENT_BATCH)
  @ValidateNested({ each: true })
  @Type(() => ResourceEnvironmentDto)
  items: ResourceEnvironmentDto[];
}
