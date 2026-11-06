import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ScanHistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  awsAccountId?: string;
}
