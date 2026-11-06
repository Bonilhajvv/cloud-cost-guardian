import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { RecommendationStatus, RecommendationType } from '../../common/enums';

export class ListRecommendationsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;

  @IsOptional()
  @IsEnum(RecommendationType)
  type?: RecommendationType;

  @IsOptional()
  @IsUUID()
  awsAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  service?: string;

  @IsOptional()
  @IsIn(['savings', 'createdAt'])
  sortBy: 'savings' | 'createdAt' = 'savings';
}
