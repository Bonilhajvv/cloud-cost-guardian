import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { ListResourcesDto } from './dto/list-resources.dto';
import { SetEnvironmentDto, SetEnvironmentsDto } from './dto/set-environment.dto';
import { ResourceInventoryService } from './resource-inventory.service';

@ApiTags('Resources')
@ApiBearerAuth()
@Roles(...ORG_READ_ROLES)
@Controller('resources')
export class ResourceInventoryController {
  constructor(private readonly inventory: ResourceInventoryService) {}

  @Get()
  list(@CurrentUser() user: TenantUser, @Query() query: ListResourcesDto) {
    return this.inventory.list(user.organizationId, query);
  }

  @Get('ec2/analysis')
  ec2Analysis(@CurrentUser() user: TenantUser, @Query() query: ListResourcesDto) {
    return this.inventory.listEc2Analyses(user.organizationId, query);
  }

  @Get(':id/usage')
  usage(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getUsage(user.organizationId, id);
  }

  @Patch('environment')
  @Roles(Role.ORG_ADMIN)
  setEnvironments(@CurrentUser() user: TenantUser, @Body() dto: SetEnvironmentsDto) {
    return this.inventory.setEnvironments(user.organizationId, dto.items);
  }

  @Patch(':id/environment')
  @Roles(Role.ORG_ADMIN)
  setEnvironment(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetEnvironmentDto) {
    return this.inventory.setEnvironment(user.organizationId, id, dto.environment);
  }

  @Get(':id')
  get(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.get(user.organizationId, id);
  }
}
