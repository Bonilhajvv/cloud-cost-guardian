import { Injectable, Logger } from '@nestjs/common';
import { detectEnvironment } from '../aws/core/helpers/environment.helper';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { Environment } from '../aws/core/interfaces/environment.interface';
import { ResourceAnalysis } from '../aws/core/interfaces/recommendation-draft.interface';
import { CostExplorerService } from '../aws/costs/cost-explorer.service';
import { RDS_BACKUP_REFRESH_MS, RDS_BACKUP_WINDOW_DAYS } from '../aws/rds/constants/rds.constant';
import { isAuroraEngine } from '../aws/rds/helpers/aurora.helper';
import { RdsBackupSource } from '../aws/rds/interfaces/rds-backup.interface';
import { RdsBackupAnalyzerService } from '../aws/rds/rds-backup-analyzer.service';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RecommendationType } from '../common/enums';
import { addDays, toIsoDate, todayUtc } from '../common/helpers/date.helper';
import { RDS_BACKUP_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AURORA_CLUSTER_RESOURCE_TYPE, RDS_DB_INSTANCE_RESOURCE_TYPE, SNAPSHOT_RESOURCE_TYPES } from '../resource-inventory/constants/resource-types.constant';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY } from './constants/scan.constant';
import { ServiceAnalysisDetails } from './interfaces/scan-report.interface';

@Injectable()
export class RdsBackupScanService {
  private readonly logger = new Logger(RdsBackupScanService.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly costExplorer: CostExplorerService,
    private readonly accounts: AwsAccountsService,
    private readonly analyzer: RdsBackupAnalyzerService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async sync(account: AwsAccount, now = new Date()): Promise<{ fetched: boolean; regions: number; error?: string }> {
    const cached = account.rdsBackup;
    if (cached && now.getTime() - Date.parse(cached.fetchedAt) < RDS_BACKUP_REFRESH_MS) return { fetched: false, regions: cached.regions.length };
    try {
      const today = todayUtc();
      const regions = await this.costExplorer.getRdsBackupCosts(account, toIsoDate(addDays(today, -RDS_BACKUP_WINDOW_DAYS)), toIsoDate(today));
      account.rdsBackup = { fetchedAt: now.toISOString(), regions };
      await this.accounts.saveRdsBackup(account.id, account.rdsBackup);
      return { fetched: true, regions: regions.length };
    } catch (error) {
      const err = toAwsIntegrationError(error);
      this.logger.warn({ msg: 'RDS backup cost unavailable', awsAccountRef: account.id, code: err.code, error: err.message });
      return { fetched: false, regions: cached?.regions.length ?? 0, error: `${err.code}: ${err.message}` };
    }
  }

  async analyze(account: AwsAccount, now = new Date()): Promise<ServiceAnalysisDetails | null> {
    const snapshot = account.rdsBackup;
    if (!snapshot) return null;
    const [databases, clusters, snapshots] = await Promise.all([
      this.inventory.findByType(account.id, RDS_DB_INSTANCE_RESOURCE_TYPE),
      this.inventory.findByType(account.id, AURORA_CLUSTER_RESOURCE_TYPE),
      this.inventory.findByType(account.id, SNAPSHOT_RESOURCE_TYPES.RDS),
    ]);
    const source = (id: string, region: string | null, retentionDays: number | null, tags: Record<string, string>, override: Environment | null): { region: string | null; source: RdsBackupSource } => ({
      region,
      source: { id, retentionDays, nonProduction: detectEnvironment(id, tags, override).environment === 'NON_PRODUCTION' },
    });
    const sources = [
      ...databases.flatMap((r) => {
        const db = r.metadata.rds;
        return db && !isAuroraEngine(db.engine) && !db.clusterId ? [source(db.dbInstanceId, r.region, db.backupRetentionDays ?? null, db.tags, r.environment)] : [];
      }),
      ...clusters.flatMap((r) => {
        const c = r.metadata.auroraCluster?.cluster;
        return c ? [source(c.clusterId, r.region, c.backupRetentionDays, c.tags, r.environment)] : [];
      }),
    ];
    const results = snapshot.regions.map((cost) =>
      this.analyzer.analyze({
        cost,
        sources: sources.filter((s) => s.region === cost.region).map((s) => s.source),
        oldManualSnapshots: snapshots.filter((r) => r.region === cost.region && r.metadata.analysis?.recommendation?.type === RecommendationType.RDS_SNAPSHOT_OLD).length,
        currency: DEFAULT_CURRENCY,
        now,
      }),
    );
    const findings: Record<string, number> = {};
    for (const r of results) findings[r.analysis.finding] = (findings[r.analysis.finding] ?? 0) + 1;
    const analyses = new Map<string, ResourceAnalysis>(results.map((r) => [r.analysis.resourceId, r.analysis]));
    const sync = await this.recommendations.syncDrafts(account, RDS_BACKUP_RECOMMENDATION_TYPES, results.flatMap((r) => r.drafts), analyses);
    return { analyzed: results.length, findings, ...sync };
  }
}

