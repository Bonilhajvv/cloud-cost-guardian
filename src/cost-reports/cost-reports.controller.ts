import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { ORG_READ_ROLES } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { CostReportsService } from './cost-reports.service';
import { CostQueryDto, DailyCostQueryDto, ResourceCostQueryDto, TrendQueryDto } from './dto/cost-query.dto';

@ApiTags('Costs')
@ApiBearerAuth()
@Roles(...ORG_READ_ROLES)
@Controller('costs')
export class CostReportsController {
  constructor(private readonly reports: CostReportsService) {}

  @Get('summary')
  summary(@CurrentUser() user: TenantUser, @Query() query: CostQueryDto) {
    return this.reports.summary(user.organizationId, query.awsAccountId);
  }

  @Get('daily')
  daily(@CurrentUser() user: TenantUser, @Query() query: DailyCostQueryDto) {
    return this.reports.daily(user.organizationId, query.days, query.awsAccountId);
  }

  @Get('trend')
  trend(@CurrentUser() user: TenantUser, @Query() query: TrendQueryDto) {
    return this.reports.trend(user.organizationId, query.months, query.awsAccountId);
  }

  @Get('by-resource')
  byResource(@CurrentUser() user: TenantUser, @Query() query: ResourceCostQueryDto) {
    return this.reports.byResource(user.organizationId, query.limit, query.awsAccountId);
  }
}
