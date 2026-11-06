import { randomBytes } from 'crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AwsConnectionService } from '../aws/core/aws-connection.service';
import { AwsCredentialsService } from '../aws/core/aws-credentials.service';
import { ConnectionTestResult } from '../aws/core/interfaces/connection-test-result.interface';
import { AuditAction, AwsAccountStatus, OrganizationStatus } from '../common/enums';
import { paginate } from '../common/helpers/paginate.helper';
import { Paginated } from '../common/interfaces/paginated.interface';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { EnvironmentVariables } from '../config/env.validation';
import { CFN_STACK_NAME, CFN_TEMPLATE_PUBLIC_PATH, SUGGESTED_ROLE_NAME } from './constants/aws-account.constant';
import { AwsAccountSetupDto } from './dto/aws-account-setup.dto';
import { CreateAwsAccountDto } from './dto/create-aws-account.dto';
import { ListAwsAccountsDto } from './dto/list-aws-accounts.dto';
import { UpdateAwsAccountDto } from './dto/update-aws-account.dto';
import { AwsAccount } from './entities/aws-account.entity';
import { buildQuickCreateUrl, predictedRoleArn } from './helpers/cloudformation.helper';
import { buildPermissionsPolicy, buildTrustPolicy } from './helpers/iam-policy.helper';

@Injectable()
export class AwsAccountsService {
  private readonly logger = new Logger(AwsAccountsService.name);

  constructor(
    @InjectRepository(AwsAccount) private readonly repo: Repository<AwsAccount>,
    private readonly connection: AwsConnectionService,
    private readonly credentials: AwsCredentialsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async create(user: TenantUser, dto: CreateAwsAccountDto): Promise<AwsAccount> {
    const existing = await this.repo.findOneBy({
      organizationId: user.organizationId,
      awsAccountId: dto.awsAccountId,
    });
    if (existing && existing.status !== AwsAccountStatus.DISCONNECTED) {
      throw new ConflictException('This AWS account is already connected to your organization');
    }
    const account = existing ?? this.repo.create({ organizationId: user.organizationId });
    Object.assign(account, {
      name: dto.name,
      awsAccountId: dto.awsAccountId,
      defaultRegion: dto.defaultRegion,
      roleArn: dto.roleArn ?? predictedRoleArn(dto.awsAccountId),
      externalId: randomBytes(24).toString('hex'),
      status: AwsAccountStatus.PENDING,
      lastError: null,
      lastErrorAt: null,
    });
    const saved = await this.repo.save(account);
    this.logger.log({ msg: 'AWS account registered', organizationId: user.organizationId, awsAccountRef: saved.id, reactivated: !!existing });
    return saved;
  }

  async list(organizationId: string, query: ListAwsAccountsDto): Promise<Paginated<AwsAccount>> {
    const [items, total] = await this.repo.findAndCount({
      where: { organizationId, ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items, total, query);
  }

  async get(organizationId: string, id: string): Promise<AwsAccount> {
    const account = await this.repo.findOneBy({ id, organizationId });
    if (!account) throw new NotFoundException('AWS account not found');
    return account;
  }

  async getSetup(organizationId: string, id: string): Promise<AwsAccountSetupDto> {
    const account = await this.get(organizationId, id);
    const platformAccountId = this.config.get('AWS_PLATFORM_ACCOUNT_ID', { infer: true });
    const hostedTemplate = this.config.get('CFN_TEMPLATE_URL', { infer: true }) || null;
    return {
      awsAccountRef: account.id,
      externalId: account.externalId,
      platformAccountId,
      suggestedRoleName: SUGGESTED_ROLE_NAME,
      trustPolicy: buildTrustPolicy(platformAccountId, account.externalId),
      permissionsPolicy: buildPermissionsPolicy(),
      expectedRoleArn: account.roleArn ?? predictedRoleArn(account.awsAccountId),
      cloudFormation: {
        quickCreateUrl: hostedTemplate ? buildQuickCreateUrl(hostedTemplate, account.externalId, platformAccountId) : null,
        templateUrl: hostedTemplate ?? `${this.config.get('PUBLIC_API_URL', { infer: true })}${CFN_TEMPLATE_PUBLIC_PATH}`,
        stackName: CFN_STACK_NAME,
      },
      steps: [
        `Open cloudFormation.quickCreateUrl while logged into AWS account ${account.awsAccountId} and click "Create stack"`,
        `Or create the role ${SUGGESTED_ROLE_NAME} manually with trustPolicy and permissionsPolicy`,
        'Run POST /aws-accounts/:id/test-connection (the frontend can poll it until it succeeds)',
      ],
    };
  }

  async update(organizationId: string, id: string, dto: UpdateAwsAccountDto): Promise<AwsAccount> {
    const account = await this.get(organizationId, id);
    const roleChanged = dto.roleArn !== undefined && dto.roleArn !== account.roleArn;
    if (roleChanged) {
      this.credentials.invalidate(account);
      account.status = AwsAccountStatus.PENDING;
    }
    Object.assign(account, {
      name: dto.name ?? account.name,
      defaultRegion: dto.defaultRegion ?? account.defaultRegion,
      roleArn: dto.roleArn ?? account.roleArn,
    });
    return this.repo.save(account);
  }

  async testConnection(user: TenantUser, id: string): Promise<ConnectionTestResult> {
    const account = await this.get(user.organizationId, id);
    const result = await this.connection.test(account);
    const wasConnected = account.status === AwsAccountStatus.CONNECTED;

    account.status = result.success ? AwsAccountStatus.CONNECTED : AwsAccountStatus.ERROR;
    account.lastError = result.success ? null : result.message;
    account.lastErrorAt = result.success ? null : new Date();
    await this.repo.save(account);

    await this.audit.log({
      action: AuditAction.AWS_CONNECTION_TESTED,
      organizationId: user.organizationId,
      userId: user.userId,
      targetType: 'AwsAccount',
      targetId: account.id,
      metadata: { success: result.success, errorCode: result.errorCode, warnings: result.warnings },
    });
    if (result.success && !wasConnected) {
      await this.audit.log({
        action: AuditAction.AWS_CONNECTED,
        organizationId: user.organizationId,
        userId: user.userId,
        targetType: 'AwsAccount',
        targetId: account.id,
        metadata: { awsAccountId: account.awsAccountId },
      });
    }
    return result;
  }

  async disconnect(user: TenantUser, id: string): Promise<void> {
    const account = await this.get(user.organizationId, id);
    this.credentials.invalidate(account);
    account.status = AwsAccountStatus.DISCONNECTED;
    await this.repo.save(account);
    await this.audit.log({
      action: AuditAction.AWS_DISCONNECTED,
      organizationId: user.organizationId,
      userId: user.userId,
      targetType: 'AwsAccount',
      targetId: account.id,
      metadata: { awsAccountId: account.awsAccountId },
    });
    this.logger.log({ msg: 'AWS account disconnected', organizationId: user.organizationId, awsAccountRef: account.id });
  }

  findSchedulable(): Promise<AwsAccount[]> {
    return this.repo.find({
      where: {
        status: In([AwsAccountStatus.CONNECTED, AwsAccountStatus.ERROR]),
        organization: { status: OrganizationStatus.ACTIVE },
      },
      relations: { organization: true },
      order: { lastScanAt: { direction: 'ASC', nulls: 'FIRST' } },
    });
  }

  async findConnected(organizationId: string, id: string): Promise<AwsAccount> {
    const account = await this.get(organizationId, id);
    if (account.status !== AwsAccountStatus.CONNECTED && account.status !== AwsAccountStatus.ERROR) {
      throw new ConflictException('AWS account must be connected (run test-connection first)');
    }
    return account;
  }

  async markSynced(
    id: string,
    field: 'lastScanAt' | 'lastCostSyncAt' | 'lastOptimizerSyncAt',
    extra: Partial<Pick<AwsAccount, 'regions'>> = {},
  ): Promise<void> {
    await this.repo.update({ id }, { [field]: new Date(), status: AwsAccountStatus.CONNECTED, lastError: null, lastErrorAt: null, ...extra });
  }

  async markError(id: string, message: string): Promise<void> {
    await this.repo.update({ id }, { status: AwsAccountStatus.ERROR, lastError: message.slice(0, 2000), lastErrorAt: new Date() });
  }

  countByOrganization(organizationId: string): Promise<{ status: AwsAccountStatus; count: string }[]> {
    return this.repo
      .createQueryBuilder('a')
      .select('a.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('a.organizationId = :organizationId', { organizationId })
      .groupBy('a.status')
      .getRawMany();
  }
}
