import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AwsAccountStatus } from '../../common/enums';

export class AdminListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class AdminAwsAccountsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(AwsAccountStatus)
  status?: AwsAccountStatus;
}
