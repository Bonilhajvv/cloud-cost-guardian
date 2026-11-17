import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsTimeZone, Max, Min } from 'class-validator';

export class UpdateWorkScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days: number[];

  @IsInt()
  @Min(0)
  @Max(23)
  startHour: number;

  @IsInt()
  @Min(1)
  @Max(24)
  endHour: number;

  @IsTimeZone()
  timezone: string;
}
