import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ListResourcesDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  awsAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  resourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
