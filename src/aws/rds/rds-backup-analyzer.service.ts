import { Injectable } from '@nestjs/common';
import { Level, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { buildServiceAnalysis } from '../core/helpers/service-analysis.helper';
import { ServiceAnalysisResult, ServiceOpportunity } from '../core/interfaces/service-analysis.interface';
import { RDS_BACKUP_MIN_MONTHLY_COST, RDS_LONG_RETENTION_DAYS } from './constants/rds.constant';
import { RdsBackupAnalyzerInput } from './interfaces/rds-backup.interface';

@Injectable()
export class RdsBackupAnalyzerService {
  analyze(input: RdsBackupAnalyzerInput): ServiceAnalysisResult {
    const { cost, currency } = input;
    const resourceId = `rds-backup/${cost.region}`;
    const longRetention = input.sources.filter((s) => (s.retentionDays ?? 0) > RDS_LONG_RETENTION_DAYS);
    const base = {
      kind: 'RDS_BACKUP' as const,
      resourceId,
      resourceArn: null,
      name: `RDS backups ${cost.region}`,
      region: cost.region,
      current: {
        monthlyCost: round(cost.monthlyCost),
        details: { chargedGbMonth: round(cost.gbMonth), longRetentionDatabases: longRetention.length, oldManualSnapshots: input.oldManualSnapshots },
      },
      notes: ['Cost of the backup storage beyond the free allowance, from Cost Explorer'],
    };
    const opportunities: ServiceOpportunity[] = [];
    const causes = longRetention.length > 0 || input.oldManualSnapshots > 0;
    const unexplained = !causes && !!input.incomplete;
    if (cost.monthlyCost >= RDS_BACKUP_MIN_MONTHLY_COST && (causes || unexplained)) {
      const list = longRetention
        .sort((a, b) => Number(b.nonProduction) - Number(a.nonProduction) || (b.retentionDays ?? 0) - (a.retentionDays ?? 0))
        .slice(0, 10)
        .map((s) => `${s.id} (${s.retentionDays} days${s.nonProduction ? ', non-production' : ''})`);
      opportunities.push({
        type: RecommendationType.RDS_BACKUP_EXCESS,
        targetKey: 'REDUCE_BACKUPS',
        title: `Reduce RDS backup storage in ${cost.region}`,
        reasons: [
          `RDS charged ${currency} ${round(cost.monthlyCost)} in the last 30 days for ${round(cost.gbMonth)} GB-month of backups beyond the free allowance`,
          ...(list.length ? [`Automated backup retention above ${RDS_LONG_RETENTION_DAYS} days: ${list.join(', ')}`] : []),
          ...(input.oldManualSnapshots ? [`${input.oldManualSnapshots} manual snapshots are 90 days old or more (see RDS_SNAPSHOT_OLD)`] : []),
          ...(input.incomplete ? ['The role could not read every retention period and manual snapshot of the region: update it with rds:DescribeDBInstances, rds:DescribeDBClusters and rds:DescribeDBSnapshots to see all the causes'] : []),
          'Confirm retention and compliance policies first: a shorter retention deletes older recovery points for good',
          `AWS does not report the size of each backup, so the saving is unknown, at most ${currency} ${round(cost.monthlyCost)}/month`,
        ],
        monthlySavings: null,
        risk: Level.MEDIUM,
        confidence: unexplained ? Level.LOW : Level.MEDIUM,
      });
    }
    const result = buildServiceAnalysis(base, 'rds', opportunities, currency, input.now ?? new Date());
    if (unexplained) result.analysis.finding = 'INSUFFICIENT_DATA';
    return result;
  }
}
