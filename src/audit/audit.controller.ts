import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(Role.ORG_ADMIN)
  list(@CurrentUser() user: TenantUser, @Query() query: PaginationQueryDto) {
    return this.audit.listForOrganization(user.organizationId, query);
  }
}
