import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, SkipTenant } from '../common/decorators';
import { Role } from '../common/enums';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { AdminService } from './admin.service';
import { AdminAwsAccountsQueryDto, AdminListQueryDto } from './dto/admin-list-query.dto';
import { UpdateOrganizationStatusDto } from './dto/update-organization-status.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@SkipTenant()
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('organizations')
  organizations(@Query() query: AdminListQueryDto) {
    return this.admin.listOrganizations(query);
  }

  @Patch('organizations/:id/status')
  setStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationStatusDto,
  ) {
    return this.admin.setOrganizationStatus(id, dto.status, user.userId);
  }

  @Get('users')
  users(@Query() query: AdminListQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('aws-accounts')
  awsAccounts(@Query() query: AdminAwsAccountsQueryDto) {
    return this.admin.listAwsAccounts(query);
  }

  @Get('integration-errors')
  integrationErrors(@Query() query: AdminListQueryDto) {
    return this.admin.integrationErrors(query);
  }

  @Get('resources')
  resources(@Query() query: AdminListQueryDto) {
    return this.admin.listResources(query);
  }

  @Get('recommendations')
  recommendations(@Query() query: AdminListQueryDto) {
    return this.admin.listRecommendations(query);
  }
}
