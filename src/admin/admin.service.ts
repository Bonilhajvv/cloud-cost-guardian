import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { AuditAction, AwsAccountStatus, OrganizationStatus } from '../common/enums';
import { paginate } from '../common/helpers/paginate.helper';
import { Paginated } from '../common/interfaces/paginated.interface';
import { CostReportsService } from '../cost-reports/cost-reports.service';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { User } from '../users/entities/user.entity';
import { DAY_MS } from './constants/admin.constant';
import { AdminAwsAccountsQueryDto, AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminOrganizationRow, AdminStats } from './interfaces/admin-stats.interface';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AwsAccount) private readonly awsAccounts: Repository<AwsAccount>,
    @InjectRepository(AwsResource) private readonly resources: Repository<AwsResource>,
    @InjectRepository(Recommendation) private readonly recommendations: Repository<Recommendation>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    private readonly organizationsService: OrganizationsService,
    private readonly recommendationsService: RecommendationsService,
    private readonly costReports: CostReportsService,
  ) {}

  async stats(): Promise<AdminStats> {
    const [
      totalOrganizations,
      suspendedOrganizations,
      totalUsers,
      awsAccountsTotal,
      awsAccountsConnected,
      integrationErrors,
      resourcesMonitored,
      recommendationsGenerated,
      scanFailuresLast24h,
      spend,
      savings,
    ] = await Promise.all([
      this.organizations.count(),
      this.organizations.countBy({ status: OrganizationStatus.SUSPENDED }),
      this.users.count(),
      this.awsAccounts.count(),
      this.awsAccounts.countBy({ status: AwsAccountStatus.CONNECTED }),
      this.awsAccounts.countBy({ status: AwsAccountStatus.ERROR }),
      this.resources.count(),
      this.recommendations.count(),
      this.auditLogs.countBy({ action: AuditAction.SCAN_FAILED, createdAt: MoreThanOrEqual(new Date(Date.now() - DAY_MS)) }),
      this.costReports.totalMonthToDate(),
      this.recommendationsService.savingsSummary(),
    ]);
    return {
      totalOrganizations,
      activeOrganizations: totalOrganizations - suspendedOrganizations,
      suspendedOrganizations,
      totalUsers,
      awsAccountsTotal,
      awsAccountsConnected,
      resourcesMonitored,
      awsSpendMonitoredMonthToDate: spend.amount,
      potentialSavingsMonthly: savings.potentialMonthly,
      potentialSavingsAnnual: savings.potentialAnnual,
      recommendationsGenerated,
      integrationErrors,
      scanFailuresLast24h,
      currency: spend.currency,
    };
  }

  async listOrganizations(query: AdminListQueryDto): Promise<Paginated<AdminOrganizationRow>> {
    const qb = this.organizations
      .createQueryBuilder('o')
      .select(['o.id AS id', 'o.name AS name', 'o.slug AS slug', 'o.status AS status', 'o."createdAt" AS "createdAt"'])
      .addSelect('(SELECT COUNT(*) FROM organization_users ou WHERE ou."organizationId" = o.id)', 'users')
      .addSelect('(SELECT COUNT(*) FROM aws_accounts a WHERE a."organizationId" = o.id)', 'awsAccounts')
      .orderBy('o."createdAt"', 'DESC')
      .offset(query.skip)
      .limit(query.limit);
    if (query.search) qb.where('o.name ILIKE :s OR o.slug ILIKE :s', { s: `%${query.search}%` });
    const [rows, total] = await Promise.all([
      qb.getRawMany<AdminOrganizationRow & { users: string; awsAccounts: string }>(),
      qb.getCount(),
    ]);
    return paginate(
      rows.map((r) => ({ ...r, users: Number(r.users), awsAccounts: Number(r.awsAccounts) })),
      total,
      query,
    );
  }

  async setOrganizationStatus(id: string, status: OrganizationStatus, adminUserId: string): Promise<Organization> {
    const org = await this.organizationsService.setStatus(id, status);
    this.logger.warn({ msg: 'Organization status changed by platform admin', organizationId: id, status, adminUserId });
    return org;
  }

  async listUsers(query: AdminListQueryDto): Promise<Paginated<User>> {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.memberships', 'm')
      .orderBy('u.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);
    if (query.organizationId) qb.andWhere('m.organizationId = :organizationId', { organizationId: query.organizationId });
    if (query.search) qb.andWhere('(u.email ILIKE :s OR u.name ILIKE :s)', { s: `%${query.search}%` });
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query);
  }

  async listAwsAccounts(query: AdminAwsAccountsQueryDto): Promise<Paginated<Omit<AwsAccount, 'externalId'>>> {
    const [items, total] = await this.awsAccounts.findAndCount({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { updatedAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items.map(({ externalId: _externalId, ...rest }) => rest), total, query);
  }

  async integrationErrors(query: AdminListQueryDto): Promise<Paginated<AuditLog>> {
    const [items, total] = await this.auditLogs.findAndCount({
      where: {
        action: AuditAction.SCAN_FAILED,
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items, total, query);
  }

  async listResources(query: AdminListQueryDto): Promise<Paginated<AwsResource>> {
    const [items, total] = await this.resources.findAndCount({
      where: query.organizationId ? { organizationId: query.organizationId } : {},
      order: { lastSeenAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items, total, query);
  }

  async listRecommendations(query: AdminListQueryDto): Promise<Paginated<Recommendation>> {
    const [items, total] = await this.recommendations.findAndCount({
      where: query.organizationId ? { organizationId: query.organizationId } : {},
      order: { estimatedMonthlySavings: { direction: 'DESC', nulls: 'LAST' } },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items, total, query);
  }
}
