import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { RecommendationStatus } from '../../common/enums';

export class UpdateRecommendationStatusDto {
  @IsEnum(RecommendationStatus)
  status: RecommendationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  realizedMonthlySavings?: number;
}
