import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { forEachRegion } from '../aws/core/helpers/region-runner.helper';
import { RegionFailure } from '../aws/core/interfaces/region-run-result.interface';
import { Ec2AnalyzerService } from '../aws/ec2/ec2-analyzer.service';
import { Ec2Service } from '../aws/ec2/ec2.service';
import { downsizeCandidateType } from '../aws/ec2/helpers/downsize-candidate.helper';
import { sameSizeAlternatives } from '../aws/ec2/helpers/instance-options.helper';
import { Ec2InstanceDetails } from '../aws/ec2/interfaces/ec2-instance.interface';
import { RecommendationDraft } from '../aws/core/interfaces/recommendation-draft.interface';
import { EbsAnalyzerService } from '../aws/ebs/ebs-analyzer.service';
import { EbsService } from '../aws/ebs/ebs.service';
import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { ComputeOptimizerService } from '../aws/optimizer/compute-optimizer.service';
import { PricingService } from '../aws/pricing/pricing.service';
import { ResourceExplorerService } from '../aws/resources/resource-explorer.service';
import { AuditAction } from '../common/enums';
import { CostReportsService } from '../cost-reports/cost-reports.service';
import { CostSyncService } from '../cost-reports/cost-sync.service';
import { AdvisoryLockService } from '../database/advisory-lock.service';
import { KubernetesMetricsService } from '../kubernetes/kubernetes-metrics.service';
import { EBS_RECOMMENDATION_TYPES, EC2_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { EBS_VOLUME_RESOURCE_TYPE, EC2_INSTANCE_RESOURCE_TYPE } from '../resource-inventory/constants/resource-types.constant';
import { ebsToResourceData } from '../resource-inventory/helpers/ebs-to-resource-data.helper';
import { ec2ToResourceData } from '../resource-inventory/helpers/ec2-to-resource-data.helper';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY, FATAL_STEPS, METRICS_PERIOD_DAYS, scanLockKey } from './constants/scan.constant';
import { groupByRegion } from './helpers/group-by-region.helper';
import {
  AnalysisDetails,
  OptimizerSyncDetails,
  ResourceScanDetails,
  ScanReport,
  ScanStep,
  ScanTrigger,
  StepResult,
} from './interfaces/scan-report.interface';

@Injectable()
export class ScanOrchestratorService {
  private readonly logger = new Logger(ScanOrchestratorService.name);

  constructor(
    private readonly accounts: AwsAccountsService,
    private readonly inventory: ResourceInventoryService,
    private readonly resourceExplorer: ResourceExplorerService,
    private readonly ec2: Ec2Service,
    private readonly cloudWatch: CloudWatchService,
    private readonly optimizer: ComputeOptimizerService,
    private readonly pricing: PricingService,
    private readonly analyzer: Ec2AnalyzerService,
    private readonly ebs: EbsService,
    private readonly ebsAnalyzer: EbsAnalyzerService,
    private readonly costSync: CostSyncService,
    private readonly costReports: CostReportsService,
    private readonly recommendations: RecommendationsService,
    private readonly locks: AdvisoryLockService,
    private readonly audit: AuditService,
    private readonly kubernetesMetrics: KubernetesMetricsService,
  ) {}

  async run(account: AwsAccount, steps: readonly ScanStep[], trigger: ScanTrigger, userId?: string): Promise<ScanReport> {
    const startedAt = new Date();
    const locked = await this.locks.tryWithLock(scanLockKey(account.id), () =>
      this.runLocked(account, steps, trigger, startedAt, userId),
    );
    if (locked.acquired) return locked.value;
    return {
      awsAccountRef: account.id,
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'SKIPPED_LOCKED',
      steps: [],
    };
  }

  private async runLocked(
    account: AwsAccount,
    steps: readonly ScanStep[],
    trigger: ScanTrigger,
    startedAt: Date,
    userId?: string,
  ): Promise<ScanReport> {
    const ctx = { awsAccountRef: account.id, organizationId: account.organizationId, trigger };
    this.logger.log({ msg: 'Scan started', ...ctx, steps });
    await this.audit.log({
      action: AuditAction.SCAN_STARTED,
      organizationId: account.organizationId,
      userId: userId ?? null,
      targetType: 'AwsAccount',
      targetId: account.id,
      metadata: { trigger, steps },
    });

    const results: StepResult[] = [];
    let failed = false;
    for (const step of steps) {
      const result = await this.runStep(account, step);
      results.push(result);
      if (result.status === 'FAILED' && FATAL_STEPS.includes(step)) {
        failed = true;
        await this.accounts.markError(account.id, result.error ?? 'Scan failed');
        break;
      }
    }

    const report: ScanReport = {
      awsAccountRef: account.id,
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: failed ? 'FAILED' : 'FINISHED',
      steps: results,
    };
    await this.audit.log({
      action: failed ? AuditAction.SCAN_FAILED : AuditAction.SCAN_FINISHED,
      organizationId: account.organizationId,
      userId: userId ?? null,
      targetType: 'AwsAccount',
      targetId: account.id,
      metadata: { ...report },
    });
    const durationMs = Date.parse(report.finishedAt) - startedAt.getTime();
    if (failed) this.logger.error({ msg: 'Scan failed', ...ctx, durationMs, steps: results });
    else this.logger.log({ msg: 'Scan finished', ...ctx, durationMs, steps: results.map((s) => ({ step: s.step, status: s.status, durationMs: s.durationMs })) });
    return report;
  }

  private async runStep(account: AwsAccount, step: ScanStep): Promise<StepResult> {
    const started = Date.now();
    this.logger.log({ msg: 'Scan step started', awsAccountRef: account.id, step });
    try {
      const details = await this.executeStep(account, step);
      const result: StepResult = { step, status: 'OK', durationMs: Date.now() - started, details: { ...details } };
      this.logger.log({ msg: 'Scan step finished', awsAccountRef: account.id, step, durationMs: result.durationMs });
      return result;
    } catch (error) {
      const err = toAwsIntegrationError(error);
      this.logger.error({ msg: 'Scan step failed', awsAccountRef: account.id, step, code: err.code, error: err.message }, error instanceof Error ? error.stack : undefined);
      return { step, status: 'FAILED', durationMs: Date.now() - started, error: `${err.code}: ${err.message}` };
    }
  }

  private executeStep(account: AwsAccount, step: ScanStep): Promise<object> {
    switch (step) {
      case 'RESOURCES':
        return this.scanResources(account);
      case 'COSTS':
        return this.syncCosts(account);
      case 'OPTIMIZER':
        return this.syncOptimizer(account);
      case 'ANALYSIS':
        return this.analyze(account);
    }
  }

  async scanResources(account: AwsAccount): Promise<ResourceScanDetails> {
    const seenAt = new Date();
    const discovery = await this.resourceExplorer.discover(account);
    const failures: RegionFailure[] = [...discovery.failures];
    let instances: Ec2InstanceDetails[] = [];
    let resourceCount = discovery.resources.length;
    let ebsRegions: string[] = [];

    if (discovery.mode === 'UNAVAILABLE') {
      this.logger.warn({ msg: 'Resource Explorer not configured, falling back to EC2 DescribeInstances in every region', awsAccountRef: account.id });
      const regions = await this.ec2.listEnabledRegions(account);
      ebsRegions = regions;
      const run = await forEachRegion(regions, (region) => this.ec2.listInstances(account, region));
      failures.push(...run.failures);
      instances = run.results.flatMap((r) => r.value);
      resourceCount = instances.length;
      await this.inventory.upsertDiscovered(account, instances.map(ec2ToResourceData), seenAt);
    } else {
      await this.inventory.upsertDiscovered(account, discovery.resources, seenAt);
      const ec2ByRegion = groupByRegion(
        discovery.resources.filter((r) => r.resourceType === EC2_INSTANCE_RESOURCE_TYPE),
        (r) => r.region,
      );
      const run = await forEachRegion([...ec2ByRegion.keys()], (region) =>
        this.ec2.listInstances(account, region, (ec2ByRegion.get(region) ?? []).map((r) => r.resourceId)),
      );
      failures.push(...run.failures);
      instances = run.results.flatMap((r) => r.value);
      ebsRegions = [...groupByRegion(discovery.resources.filter((r) => r.resourceType === EBS_VOLUME_RESOURCE_TYPE), (r) => r.region).keys()];
    }

    const instancesByRegion = groupByRegion(instances, (i) => i.region);
    const enrich = await forEachRegion([...instancesByRegion.keys()], (region) =>
      this.enrichRegion(account, region, instancesByRegion.get(region) ?? []),
    );
    failures.push(...enrich.failures);

    const ebsRun = await forEachRegion(
      [...new Set([...ebsRegions, ...instancesByRegion.keys()])],
      (region) => this.enrichVolumes(account, region, seenAt),
    );
    failures.push(...ebsRun.failures);
    const ebsVolumes = ebsRun.results.reduce((s, r) => s + r.value, 0);

    const regions = [
      ...new Set([
        ...(discovery.mode === 'UNAVAILABLE' ? [] : discovery.resources.map((r) => r.region)),
        ...instances.map((i) => i.region),
      ].filter((r): r is string => !!r && r !== 'global')),
    ].sort();
    const staleRemoved = failures.length === 0 ? await this.inventory.removeStale(account.id, seenAt) : 0;
    await this.accounts.markSynced(account.id, 'lastScanAt', { regions });
    account.regions = regions;

    if (failures.length) this.logger.warn({ msg: 'Resource scan region failures', awsAccountRef: account.id, failures });
    return {
      discoveryMode: discovery.mode,
      resources: resourceCount,
      ec2Instances: instances.length,
      ebsVolumes,
      regions,
      failures,
      staleRemoved,
    };
  }

  private async enrichRegion(account: AwsAccount, region: string, instances: Ec2InstanceDetails[]): Promise<number> {
    const running = instances.filter((i) => i.state === 'running');
    const metrics = await this.cloudWatch.getEc2Utilization(account, region, running, METRICS_PERIOD_DAYS);
    const candidateTypes = [...new Set(instances.flatMap((i) => this.comparisonTypes(i.instanceType)))];
    const specs = await this.ec2.describeInstanceTypes(account, region, candidateTypes);
    const prices = await this.onDemandPrices(region, instances);
    for (const instance of instances) {
      const candidate = downsizeCandidateType(instance.instanceType);
      const priceTable = prices.get(this.pricing.pricingOs(instance.platform) ?? '') ?? {};
      const related = [instance.instanceType, ...this.comparisonTypes(instance.instanceType)];
      const onDemandMonthlyPrices = Object.fromEntries(
        related.filter((t) => priceTable[t] !== undefined).map((t) => [t, priceTable[t]]),
      );
      const typeSpecs = Object.fromEntries(
        related.flatMap((t) => {
          const spec = specs.get(t);
          return spec ? [[t, spec] as const] : [];
        }),
      );
      await this.inventory.patchMetadata(account.id, instance.instanceId, {
        ec2: instance,
        tags: instance.tags,
        metrics: metrics.get(instance.instanceId) ?? null,
        downsizeCandidate: candidate ? (specs.get(candidate) ?? null) : null,
        onDemandMonthlyPrices,
        typeSpecs,
      });
    }
    this.logger.log({ msg: 'EC2 region enriched', awsAccountRef: account.id, region, instances: instances.length, withMetrics: metrics.size });
    return instances.length;
  }

  private comparisonTypes(instanceType: string): string[] {
    const candidate = downsizeCandidateType(instanceType);
    return [...(candidate ? [candidate] : []), ...sameSizeAlternatives(instanceType)];
  }

  private async enrichVolumes(account: AwsAccount, region: string, seenAt: Date): Promise<number> {
    const volumes = await this.ebs.listVolumes(account, region);
    if (volumes.length === 0) return 0;
    await this.inventory.upsertDiscovered(account, volumes.map(ebsToResourceData), seenAt);
    const metrics = await this.cloudWatch.getEbsUtilization(account, region, volumes.map((v) => v.volumeId), METRICS_PERIOD_DAYS);
    const prices = await this.pricing.getEbsMonthlyPricePerGb(region, [...volumes.map((v) => v.volumeType), 'gp3']);
    for (const volume of volumes) {
      await this.inventory.patchMetadata(account.id, volume.volumeId, {
        ebs: volume,
        tags: volume.tags,
        ebsMetrics: metrics.get(volume.volumeId) ?? null,
        ebsPricePerGbMonth: prices,
      });
    }
    this.logger.log({
      msg: 'EBS region enriched',
      awsAccountRef: account.id,
      region,
      volumes: volumes.length,
      unattached: volumes.filter((v) => v.state === 'available').length,
      gp2: volumes.filter((v) => v.volumeType === 'gp2').length,
    });
    return volumes.length;
  }

  private async onDemandPrices(region: string, instances: Ec2InstanceDetails[]): Promise<Map<string, Record<string, number>>> {
    const typesByOs = new Map<string, Set<string>>();
    for (const instance of instances) {
      const os = this.pricing.pricingOs(instance.platform);
      if (!os) continue;
      const set = typesByOs.get(os) ?? new Set<string>();
      set.add(instance.instanceType);
      for (const t of this.comparisonTypes(instance.instanceType)) set.add(t);
      typesByOs.set(os, set);
    }
    const out = new Map<string, Record<string, number>>();
    for (const [os, types] of typesByOs) out.set(os, await this.pricing.getEc2MonthlyPrices(region, [...types], os));
    return out;
  }

  async syncCosts(account: AwsAccount): Promise<object> {
    const summary = await this.costSync.syncAccount(account);
    await this.accounts.markSynced(account.id, 'lastCostSyncAt');
    return summary;
  }

  async syncOptimizer(account: AwsAccount): Promise<OptimizerSyncDetails> {
    const resources = await this.inventory.findEc2Instances(account.id);
    const byRegion = groupByRegion(resources, (r) => r.region);
    const regionStatus: Record<string, string> = {};
    let total = 0;

    const run = await forEachRegion([...byRegion.keys()], async (region) => {
      const result = await this.optimizer.getEc2Recommendations(account, region);
      regionStatus[region] = result.availability;
      const optionTypes = [...new Set(result.recommendations.flatMap((r) => r.options.map((o) => o.instanceType)))];
      const specs = await this.ec2.describeInstanceTypes(account, region, optionTypes);
      const byInstance = new Map(result.recommendations.map((r) => [r.instanceId, r]));
      for (const rec of result.recommendations) {
        for (const option of rec.options) option.spec = specs.get(option.instanceType) ?? null;
      }
      for (const resource of byRegion.get(region) ?? []) {
        await this.inventory.patchMetadata(account.id, resource.resourceId, {
          computeOptimizer: byInstance.get(resource.resourceId) ?? null,
        });
      }
      total += result.recommendations.length;
    });

    const notEnrolled = Object.values(regionStatus).some((s) => s === 'NOT_ENROLLED');
    if (notEnrolled) this.logger.warn({ msg: 'Compute Optimizer not enrolled', awsAccountRef: account.id, regions: regionStatus });
    await this.accounts.markSynced(account.id, 'lastOptimizerSyncAt');
    return { regions: regionStatus, recommendations: total, failures: run.failures };
  }

  async analyze(account: AwsAccount): Promise<AnalysisDetails> {
    const resources = await this.inventory.findEc2Instances(account.id);
    const costs = await this.costReports.monthlyEstimatesByResource(account.id);
    const nodeStats = await this.kubernetesMetrics.nodeMemoryStats(account.organizationId, resources.map((r) => r.resourceId));
    const drafts: RecommendationDraft[] = [];
    const findings: Record<string, number> = {};
    let analyzed = 0;

    for (const resource of resources) {
      const m = resource.metadata;
      if (!m.ec2) continue;
      const { analysis, draft } = this.analyzer.analyze({
        instance: m.ec2,
        metrics: m.metrics ?? null,
        costExplorerMonthlyCost: costs.get(resource.resourceId) ?? null,
        optimizer: m.computeOptimizer ?? null,
        downsizeCandidate: m.downsizeCandidate ?? null,
        onDemandMonthlyPrices: m.onDemandMonthlyPrices ?? {},
        typeSpecs: m.typeSpecs ?? {},
        externalMemory: nodeStats.get(resource.resourceId) ?? null,
        currency: DEFAULT_CURRENCY,
      });
      await this.inventory.patchMetadata(account.id, resource.resourceId, { analysis });
      findings[analysis.finding] = (findings[analysis.finding] ?? 0) + 1;
      if (draft) drafts.push(draft);
      analyzed++;
    }

    const sync = await this.recommendations.syncDrafts(account, EC2_RECOMMENDATION_TYPES, drafts, true);
    this.logger.log({ msg: 'EC2 analysis finished', awsAccountRef: account.id, analyzed, findings, drafts: drafts.length });
    return { analyzed, findings, ...sync, ebs: await this.analyzeVolumes(account) };
  }

  private async analyzeVolumes(account: AwsAccount): Promise<Omit<AnalysisDetails, 'ebs'>> {
    const resources = await this.inventory.findByType(account.id, EBS_VOLUME_RESOURCE_TYPE);
    const drafts: RecommendationDraft[] = [];
    const findings: Record<string, number> = {};
    let analyzed = 0;
    for (const resource of resources) {
      const m = resource.metadata;
      if (!m.ebs) continue;
      const { analysis, draft } = this.ebsAnalyzer.analyze({
        volume: m.ebs,
        metrics: m.ebsMetrics ?? null,
        pricePerGbMonth: m.ebsPricePerGbMonth ?? {},
        currency: DEFAULT_CURRENCY,
      });
      await this.inventory.patchMetadata(account.id, resource.resourceId, { analysis });
      findings[analysis.finding] = (findings[analysis.finding] ?? 0) + 1;
      if (draft) drafts.push(draft);
      analyzed++;
    }
    const sync = await this.recommendations.syncDrafts(account, EBS_RECOMMENDATION_TYPES, drafts, true);
    this.logger.log({ msg: 'EBS analysis finished', awsAccountRef: account.id, analyzed, findings, drafts: drafts.length });
    return { analyzed, findings, ...sync };
  }
}
