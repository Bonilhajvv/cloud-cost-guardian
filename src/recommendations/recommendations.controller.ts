import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { ListRecommendationsDto } from './dto/list-recommendations.dto';
import { UpdateRecommendationStatusDto } from './dto/update-recommendation-status.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('Recommendations')
@ApiBearerAuth()
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  @Roles(...ORG_READ_ROLES)
  list(@CurrentUser() user: TenantUser, @Query() query: ListRecommendationsDto) {
    return this.recommendations.list(user.organizationId, query);
  }

  @Get(':id')
  @Roles(...ORG_READ_ROLES)
  get(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.recommendations.get(user.organizationId, id);
  }

  @Patch(':id/status')
  @Roles(Role.ORG_ADMIN)
  updateStatus(
    @CurrentUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecommendationStatusDto,
  ) {
    return this.recommendations.updateStatus(user, id, dto);
  }
}
