import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { AwsAccountRef } from '../aws/core/interfaces/aws-account-ref.interface';
import { AwsResourceData } from '../aws/resources/interfaces/aws-resource-data.interface';
import { chunk } from '../common/helpers/stats.helper';
import { paginate } from '../common/helpers/paginate.helper';
import { Paginated } from '../common/interfaces/paginated.interface';
import {
  EBS_VOLUME_RESOURCE_TYPE,
  EC2_INSTANCE_RESOURCE_TYPE,
  MEMORY_COVERAGE_HINT,
  UPSERT_CHUNK_SIZE,
} from './constants/resource-types.constant';
import { ListResourcesDto } from './dto/list-resources.dto';
import { AwsResource } from './entities/aws-resource.entity';
import { AwsResourceMetadata } from './interfaces/aws-resource-metadata.interface';
import { MetricsCoverage } from './interfaces/metrics-coverage.interface';
import { ResourceUsageView } from './interfaces/resource-usage.interface';

type CoverageKey = 'running' | 'agent' | 'insights' | 'k8s' | 'disk' | 'volumes' | 'unattached' | 'gp2';

@Injectable()
export class ResourceInventoryService {
  private readonly logger = new Logger(ResourceInventoryService.name);

  constructor(@InjectRepository(AwsResource) private readonly repo: Repository<AwsResource>) {}

  async upsertDiscovered(account: AwsAccountRef, resources: AwsResourceData[], seenAt: Date): Promise<number> {
    for (const batch of chunk(resources, UPSERT_CHUNK_SIZE)) {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(AwsResource)
        .values(
          batch.map((r) => ({
            organizationId: account.organizationId,
            awsAccountId: account.id,
            arn: r.arn,
            resourceId: r.resourceId,
            service: r.service,
            resourceType: r.resourceType,
            region: r.region ?? null,
            name: r.name ?? null,
            metadata: { tags: r.tags },
            lastSeenAt: seenAt,
          })),
        )
        .onConflict(
          `("awsAccountId", "arn") DO UPDATE SET
            "resourceId" = EXCLUDED."resourceId",
            "service" = EXCLUDED."service",
            "resourceType" = EXCLUDED."resourceType",
            "region" = EXCLUDED."region",
            "name" = EXCLUDED."name",
            "lastSeenAt" = EXCLUDED."lastSeenAt",
            "metadata" = "aws_resources"."metadata" || EXCLUDED."metadata"`,
        )
        .execute();
    }
    this.logger.log({ msg: 'Resources upserted', awsAccountRef: account.id, count: resources.length });
    return resources.length;
  }

  async removeStale(awsAccountId: string, seenBefore: Date): Promise<number> {
    const result = await this.repo.delete({ awsAccountId, lastSeenAt: LessThan(seenBefore) });
    const removed = result.affected ?? 0;
    if (removed) this.logger.log({ msg: 'Stale resources removed', awsAccountRef: awsAccountId, removed });
    return removed;
  }

  async patchMetadata(awsAccountId: string, resourceId: string, patch: AwsResourceMetadata): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(AwsResource)
      .set({ metadata: () => `"metadata" || CAST(:patch AS jsonb)` })
      .where('"awsAccountId" = :awsAccountId AND "resourceId" = :resourceId', { awsAccountId, resourceId })
      .setParameter('patch', JSON.stringify(patch))
      .execute();
  }

  findEc2Instances(awsAccountId: string): Promise<AwsResource[]> {
    return this.findByType(awsAccountId, EC2_INSTANCE_RESOURCE_TYPE);
  }

  findByType(awsAccountId: string, resourceType: string): Promise<AwsResource[]> {
    return this.repo.find({
      where: { awsAccountId, resourceType },
      order: { resourceId: 'ASC' },
    });
  }

  async list(organizationId: string, query: ListResourcesDto): Promise<Paginated<AwsResource>> {
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.organizationId = :organizationId', { organizationId })
      .orderBy('r.service', 'ASC')
      .addOrderBy('r.resourceType', 'ASC')
      .addOrderBy('r.resourceId', 'ASC')
      .skip(query.skip)
      .take(query.limit);
    if (query.awsAccountId) qb.andWhere('r.awsAccountId = :awsAccountId', { awsAccountId: query.awsAccountId });
    if (query.service) qb.andWhere('r.service = :service', { service: query.service });
    if (query.resourceType) qb.andWhere('r.resourceType = :resourceType', { resourceType: query.resourceType });
    if (query.region) qb.andWhere('r.region = :region', { region: query.region });
    if (query.search) {
      qb.andWhere('(r.name ILIKE :search OR r.resourceId ILIKE :search)', { search: `%${query.search}%` });
    }
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query);
  }

  async get(organizationId: string, id: string): Promise<AwsResource> {
    const resource = await this.repo.findOneBy({ id, organizationId });
    if (!resource) throw new NotFoundException('Resource not found');
    return resource;
  }

  findByResourceIds(organizationId: string, resourceIds: string[]): Promise<AwsResource[]> {
    if (resourceIds.length === 0) return Promise.resolve([]);
    return this.repo.find({ where: { organizationId, resourceId: In(resourceIds) } });
  }

  findKubernetesNodeCandidates(organizationId: string): Promise<AwsResource[]> {
    return this.repo
      .createQueryBuilder('r')
      .where('r.organizationId = :organizationId', { organizationId })
      .andWhere('r.resourceType = :type', { type: EC2_INSTANCE_RESOURCE_TYPE })
      .andWhere(`jsonb_typeof(r.metadata->'analysis'->'kubernetes') = 'object'`)
      .getMany();
  }

  async getUsage(organizationId: string, id: string): Promise<ResourceUsageView> {
    const resource = await this.get(organizationId, id);
    const analysis = resource.metadata.analysis;
    const ec2 = analysis && analysis.kind !== 'EBS' ? analysis : null;
    return {
      resourceId: resource.resourceId,
      name: resource.name,
      instanceType: resource.metadata.ec2?.instanceType ?? null,
      region: resource.region,
      finding: ec2?.finding ?? null,
      usage: ec2?.usage ?? null,
      options: ec2?.options ?? [],
      notes: ec2?.metrics.notes ?? [],
      analyzedAt: ec2?.analyzedAt ?? null,
    };
  }

  async listEc2Analyses(organizationId: string, query: ListResourcesDto): Promise<Paginated<AwsResource>> {
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.organizationId = :organizationId', { organizationId })
      .andWhere('r.resourceType = :type', { type: EC2_INSTANCE_RESOURCE_TYPE })
      .andWhere(`r.metadata ? 'analysis'`)
      .orderBy(`(r.metadata->'analysis'->'savings'->>'monthly')::numeric`, 'DESC', 'NULLS LAST')
      .skip(query.skip)
      .take(query.limit);
    if (query.awsAccountId) qb.andWhere('r.awsAccountId = :awsAccountId', { awsAccountId: query.awsAccountId });
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query);
  }

  async metricsCoverage(organizationId: string): Promise<MetricsCoverage> {
    const row = await this.repo
      .createQueryBuilder('r')
      .select(`COUNT(*) FILTER (WHERE r.resourceType = :ec2 AND r.metadata->'ec2'->>'state' = 'running')`, 'running')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = :ec2 AND r.metadata->'ec2'->>'state' = 'running' AND r.metadata->'analysis'->'metrics'->>'memorySource' = 'CLOUDWATCH_AGENT')`, 'agent')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = :ec2 AND r.metadata->'ec2'->>'state' = 'running' AND r.metadata->'analysis'->'metrics'->>'memorySource' = 'CONTAINER_INSIGHTS')`, 'insights')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = :ec2 AND r.metadata->'ec2'->>'state' = 'running' AND r.metadata->'analysis'->'metrics'->>'memorySource' = 'KUBERNETES_AGENT')`, 'k8s')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = :ec2 AND r.metadata->'ec2'->>'state' = 'running' AND r.metadata->'metrics'->'disk'->>'available' = 'true')`, 'disk')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = :ebs)`, 'volumes')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = :ebs AND r.metadata->'ebs'->>'state' = 'available')`, 'unattached')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = :ebs AND r.metadata->'ebs'->>'volumeType' = 'gp2')`, 'gp2')
      .where('r.organizationId = :organizationId', { organizationId })
      .setParameters({ ec2: EC2_INSTANCE_RESOURCE_TYPE, ebs: EBS_VOLUME_RESOURCE_TYPE })
      .getRawOne<Record<CoverageKey, string>>();
    const n = (k: CoverageKey) => Number(row?.[k] ?? 0);
    const unavailable = n('running') - n('agent') - n('insights') - n('k8s');
    return {
      ec2Running: n('running'),
      memory: { cloudwatchAgent: n('agent'), containerInsights: n('insights'), kubernetesAgent: n('k8s'), unavailable },
      disk: { available: n('disk'), unavailable: n('running') - n('disk') },
      ebs: { volumes: n('volumes'), unattached: n('unattached'), gp2: n('gp2') },
      hint: unavailable > 0 ? MEMORY_COVERAGE_HINT : null,
    };
  }

  async countByOrganization(organizationId: string): Promise<{ total: number; ec2: number }> {
    const row = await this.repo
      .createQueryBuilder('r')
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE r.resourceType = '${EC2_INSTANCE_RESOURCE_TYPE}')`, 'ec2')
      .where('r.organizationId = :organizationId', { organizationId })
      .getRawOne<{ total: string; ec2: string }>();
    return { total: Number(row?.total ?? 0), ec2: Number(row?.ec2 ?? 0) };
  }
}
