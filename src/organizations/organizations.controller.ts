import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
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
}
