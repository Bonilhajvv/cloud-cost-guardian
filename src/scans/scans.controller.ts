import { Controller, Get, HttpCode, Logger, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { CurrentUser, Roles } from '../common/decorators';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { FULL_SCAN_STEPS } from './constants/scan.constant';
import { ScanHistoryQueryDto } from './dto/scan-history-query.dto';
import { ScanOrchestratorService } from './scan-orchestrator.service';

@ApiTags('Scans')
@ApiBearerAuth()
@Controller()
export class ScansController {
  private readonly logger = new Logger(ScansController.name);

  constructor(
    private readonly accounts: AwsAccountsService,
    private readonly orchestrator: ScanOrchestratorService,
    private readonly audit: AuditService,
  ) {}

  @Post('aws-accounts/:id/scan')
  @HttpCode(202)
  @Roles(Role.ORG_ADMIN)
  async scan(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    const account = await this.accounts.findConnected(user.organizationId, id);
    void this.orchestrator.run(account, FULL_SCAN_STEPS, 'MANUAL', user.userId).catch((error: unknown) =>
      this.logger.error({ msg: 'Manual scan crashed', awsAccountRef: id }, error instanceof Error ? error.stack : String(error)),
    );
    return { accepted: true, awsAccountRef: account.id, steps: FULL_SCAN_STEPS };
  }

  @Get('scans/history')
  @Roles(...ORG_READ_ROLES)
  history(@CurrentUser() user: TenantUser, @Query() query: ScanHistoryQueryDto) {
    return this.audit.listScanHistory(user.organizationId, query, query.awsAccountId);
  }
}
