import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums';

export class MemberDto {
  @ApiProperty() userId: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty() joinedAt: Date;
}
