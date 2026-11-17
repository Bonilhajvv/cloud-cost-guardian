import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('me')
  @Roles(...ORG_READ_ROLES)
  me(@CurrentUser() user: TenantUser) {
    return this.organizations.findById(user.organizationId);
  }

  @Patch('me')
  @Roles(Role.ORG_ADMIN)
  update(@CurrentUser() user: TenantUser, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.rename(user.organizationId, dto.name);
  }

  @Get('me/work-schedule')
  @Roles(...ORG_READ_ROLES)
  workSchedule(@CurrentUser() user: TenantUser) {
    return this.organizations.workSchedule(user.organizationId);
  }

  @Patch('me/work-schedule')
  @Roles(Role.ORG_ADMIN)
  setWorkSchedule(@CurrentUser() user: TenantUser, @Body() dto: UpdateWorkScheduleDto) {
    return this.organizations.setWorkSchedule(user.organizationId, dto);
  }

  @Delete('me/work-schedule')
  @Roles(Role.ORG_ADMIN)
  resetWorkSchedule(@CurrentUser() user: TenantUser) {
    return this.organizations.setWorkSchedule(user.organizationId, null);
  }
}
