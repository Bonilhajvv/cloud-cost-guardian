import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AwsAccountStatus } from '../../common/enums';

export class ListAwsAccountsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AwsAccountStatus)
  status?: AwsAccountStatus;
}
