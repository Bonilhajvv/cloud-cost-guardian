import { IsDateString, IsOptional } from 'class-validator';

export class RequestCostsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
