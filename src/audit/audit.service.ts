import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { paginate } from '../common/helpers/paginate.helper';
import { Paginated } from '../common/interfaces/paginated.interface';
import { SCAN_ACTIONS } from './constants/audit.constant';
import { AuditLog } from './entities/audit-log.entity';
import { AuditEntry } from './interfaces/audit-entry.interface';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          action: entry.action,
          organizationId: entry.organizationId ?? null,
          userId: entry.userId ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          metadata: entry.metadata ?? {},
          ip: entry.ip ?? null,
        }),
      );
    } catch (error) {
      this.logger.error({ msg: 'Failed to write audit log', action: entry.action }, String(error));
    }
  }

  async listScanHistory(
    organizationId: string,
    query: PaginationQueryDto,
    awsAccountId?: string,
  ): Promise<Paginated<AuditLog>> {
    const [items, total] = await this.repo.findAndCount({
      where: {
        organizationId,
        action: In(SCAN_ACTIONS),
        ...(awsAccountId ? { targetId: awsAccountId } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items, total, query);
  }

  async listForOrganization(
    organizationId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<AuditLog>> {
    const [items, total] = await this.repo.findAndCount({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items, total, query);
  }
}
