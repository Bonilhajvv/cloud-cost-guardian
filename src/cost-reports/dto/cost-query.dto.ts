import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CostQueryDto {
  @IsOptional()
  @IsUUID()
  awsAccountId?: string;
}

export class DailyCostQueryDto extends CostQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days: number = 30;
}

export class TrendQueryDto extends CostQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  months: number = 6;
}

export class ResourceCostQueryDto extends CostQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 20;
}
