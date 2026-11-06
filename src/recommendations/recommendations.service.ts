import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AwsAccountRef } from '../aws/core/interfaces/aws-account-ref.interface';
import { RecommendationDraft } from '../aws/core/interfaces/recommendation-draft.interface';
import { AuditAction, RecommendationStatus, RecommendationType } from '../common/enums';
import { paginate } from '../common/helpers/paginate.helper';
import { round } from '../common/helpers/stats.helper';
import { Paginated } from '../common/interfaces/paginated.interface';
import { TenantUser } from '../common/interfaces/request-user.interface';
import {
  ACTIVE_STATUSES,
  OPPORTUNITY_LABELS,
  POTENTIAL_STATUSES,
  STATUS_TRANSITIONS,
} from './constants/recommendation.constant';
import { ListRecommendationsDto } from './dto/list-recommendations.dto';
import { UpdateRecommendationStatusDto } from './dto/update-recommendation-status.dto';
import { Recommendation } from './entities/recommendation.entity';
import { DraftSyncResult, SavingsSummary, TopOpportunity } from './interfaces/savings-summary.interface';

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    @InjectRepository(Recommendation) private readonly repo: Repository<Recommendation>,
    private readonly audit: AuditService,
  ) {}

  async syncDrafts(
    account: AwsAccountRef,
    types: readonly RecommendationType[],
    drafts: RecommendationDraft[],
    resolveMissing: boolean,
  ): Promise<DraftSyncResult> {
    const result: DraftSyncResult = { created: 0, updated: 0, resolved: 0, skipped: 0 };
    const existing = await this.repo.find({
      where: { awsAccountId: account.id, type: In([...types]), status: In([...ACTIVE_STATUSES, RecommendationStatus.REJECTED]) },
    });
    const key = (resourceId: string, type: RecommendationType) => `${resourceId}|${type}`;
    const byKey = new Map(existing.map((r) => [key(r.resourceId, r.type), r]));
    const touched = new Set<string>();

    for (const draft of drafts) {
      const k = key(draft.resourceId, draft.type);
      touched.add(k);
      const current = byKey.get(k);
      if (current?.status === RecommendationStatus.REJECTED) {
        const sameTarget = (current.metadata.targetKey ?? null) === draft.targetKey;
        if (sameTarget) {
          result.skipped++;
          continue;
        }
      }
      if (current && current.status !== RecommendationStatus.REJECTED) {
        if (current.status === RecommendationStatus.ACCEPTED) {
          current.metadata = { ...current.metadata, analysis: draft.analysis, targetKey: draft.targetKey };
        } else {
          this.applyDraft(current, draft);
        }
        await this.repo.save(current);
        result.updated++;
        continue;
      }
      const created = this.repo.create({ organizationId: account.organizationId, awsAccountId: account.id, status: RecommendationStatus.OPEN });
      this.applyDraft(created, draft);
      await this.repo.save(created);
      result.created++;
    }

    if (resolveMissing) {
      const stale = existing.filter(
        (r) => !touched.has(key(r.resourceId, r.type)) && POTENTIAL_STATUSES.some((s) => s === r.status),
      );
      for (const r of stale) {
        r.status = RecommendationStatus.RESOLVED;
        r.resolvedAt = new Date();
      }
      if (stale.length) await this.repo.save(stale);
      result.resolved = stale.length;
    }

    this.logger.log({ msg: 'Recommendations synced', awsAccountRef: account.id, organizationId: account.organizationId, ...result });
    return result;
  }

  async list(organizationId: string, query: ListRecommendationsDto): Promise<Paginated<Recommendation>> {
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.organizationId = :organizationId', { organizationId })
      .skip(query.skip)
      .take(query.limit);
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.type) qb.andWhere('r.type = :type', { type: query.type });
    if (query.awsAccountId) qb.andWhere('r.awsAccountId = :awsAccountId', { awsAccountId: query.awsAccountId });
    if (query.service) qb.andWhere('r.service = :service', { service: query.service });
    if (query.sortBy === 'savings') qb.orderBy('r.estimatedMonthlySavings', 'DESC', 'NULLS LAST');
    else qb.orderBy('r.createdAt', 'DESC');
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query);
  }

  async get(organizationId: string, id: string): Promise<Recommendation> {
    const rec = await this.repo.findOneBy({ id, organizationId });
    if (!rec) throw new NotFoundException('Recommendation not found');
    return rec;
  }

  async updateStatus(user: TenantUser, id: string, dto: UpdateRecommendationStatusDto): Promise<Recommendation> {
    const rec = await this.get(user.organizationId, id);
    if (!STATUS_TRANSITIONS[rec.status].includes(dto.status)) {
      throw new BadRequestException(`Cannot change status from ${rec.status} to ${dto.status}`);
    }
    const now = new Date();
    const previous = rec.status;
    rec.status = dto.status;
    rec.statusChangedBy = user.userId;
    if (dto.note) rec.metadata = { ...rec.metadata, statusNote: dto.note };
    if (dto.status === RecommendationStatus.ACCEPTED) rec.acceptedAt = now;
    if (dto.status === RecommendationStatus.IMPLEMENTED) rec.implementedAt = now;
    if (dto.status === RecommendationStatus.RESOLVED) rec.resolvedAt = now;
    if (dto.realizedMonthlySavings !== undefined) rec.realizedMonthlySavings = dto.realizedMonthlySavings;
    const saved = await this.repo.save(rec);

    const action =
      dto.status === RecommendationStatus.ACCEPTED
        ? AuditAction.RECOMMENDATION_ACCEPTED
        : dto.status === RecommendationStatus.REJECTED
          ? AuditAction.RECOMMENDATION_REJECTED
          : null;
    if (action) {
      await this.audit.log({
        action,
        organizationId: user.organizationId,
        userId: user.userId,
        targetType: 'Recommendation',
        targetId: rec.id,
        metadata: { from: previous, to: dto.status, note: dto.note ?? null, monthlySavings: rec.estimatedMonthlySavings },
      });
    }
    this.logger.log({ msg: 'Recommendation status changed', recommendationId: rec.id, organizationId: user.organizationId, from: previous, to: dto.status, userId: user.userId });
    return saved;
  }

  async savingsSummary(organizationId?: string): Promise<SavingsSummary> {
    const qb = this.repo
      .createQueryBuilder('r')
      .select(`COALESCE(SUM(r.estimatedMonthlySavings) FILTER (WHERE r.status IN (:...potential)), 0)`, 'potential')
      .addSelect(`COALESCE(SUM(r.estimatedMonthlySavings) FILTER (WHERE r.status = :accepted), 0)`, 'accepted')
      .addSelect(`COALESCE(SUM(r.estimatedMonthlySavings) FILTER (WHERE r.status = :implemented), 0)`, 'implemented')
      .addSelect(`COALESCE(SUM(r.realizedMonthlySavings), 0)`, 'realized')
      .addSelect(`COUNT(*) FILTER (WHERE r.status IN (:...potential))`, 'open')
      .setParameters({
        potential: [...POTENTIAL_STATUSES],
        accepted: RecommendationStatus.ACCEPTED,
        implemented: RecommendationStatus.IMPLEMENTED,
      });
    if (organizationId) qb.where('r.organizationId = :organizationId', { organizationId });
    const row = await qb.getRawOne<Record<'potential' | 'accepted' | 'implemented' | 'realized' | 'open', string>>();
    const potential = round(Number(row?.potential ?? 0));
    return {
      currency: 'USD',
      potentialMonthly: potential,
      potentialAnnual: round(potential * 12),
      acceptedMonthly: round(Number(row?.accepted ?? 0)),
      implementedMonthly: round(Number(row?.implemented ?? 0)),
      realizedMonthly: round(Number(row?.realized ?? 0)),
      openRecommendations: Number(row?.open ?? 0),
    };
  }

  async topOpportunities(organizationId: string): Promise<TopOpportunity[]> {
    const rows = await this.repo
      .createQueryBuilder('r')
      .select('r.type', 'type')
      .addSelect('COALESCE(SUM(r.estimatedMonthlySavings), 0)', 'savings')
      .addSelect('COUNT(*)', 'count')
      .where('r.organizationId = :organizationId', { organizationId })
      .andWhere('r.status IN (:...statuses)', { statuses: [...POTENTIAL_STATUSES] })
      .groupBy('r.type')
      .getRawMany<{ type: RecommendationType; savings: string; count: string }>();

    const byLabel = new Map<string, TopOpportunity>();
    for (const r of rows) {
      const label = OPPORTUNITY_LABELS[r.type];
      const acc = byLabel.get(label) ?? { label, monthlySavings: 0, count: 0 };
      acc.monthlySavings = round(acc.monthlySavings + Number(r.savings));
      acc.count += Number(r.count);
      byLabel.set(label, acc);
    }
    return [...byLabel.values()].sort((a, b) => b.monthlySavings - a.monthlySavings);
  }

  private applyDraft(target: Recommendation, draft: RecommendationDraft): void {
    Object.assign(target, {
      resourceId: draft.resourceId,
      resourceArn: draft.resourceArn,
      service: draft.service,
      type: draft.type,
      source: draft.source,
      title: draft.title,
      description: draft.description,
      severity: draft.severity,
      risk: draft.risk,
      confidence: draft.confidence,
      currentMonthlyCost: draft.currentMonthlyCost,
      recommendedMonthlyCost: draft.recommendedMonthlyCost,
      estimatedMonthlySavings: draft.estimatedMonthlySavings,
      estimatedYearlySavings: draft.estimatedYearlySavings,
      currency: draft.currency,
      metadata: { ...(target.metadata ?? {}), analysis: draft.analysis, targetKey: draft.targetKey },
    });
    if (target.status === RecommendationStatus.REJECTED) target.status = RecommendationStatus.OPEN;
  }
}
