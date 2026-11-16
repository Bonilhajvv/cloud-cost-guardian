import { Injectable, Logger } from '@nestjs/common';
import { COMMITMENT_REFRESH_MS, COMMITMENT_WINDOW_DAYS } from '../aws/commitments/constants/commitment.constant';
import { CommitmentAnalyzerService } from '../aws/commitments/commitment-analyzer.service';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { CostExplorerService } from '../aws/costs/cost-explorer.service';
import { CommitmentSnapshot } from '../aws/costs/interfaces/commitment.interface';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RecommendationType } from '../common/enums';
import { addDays, toIsoDate, todayUtc } from '../common/helpers/date.helper';
import { round } from '../common/helpers/stats.helper';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { DEFAULT_CURRENCY } from './constants/scan.constant';
import { CommitmentSyncDetails } from './interfaces/scan-report.interface';

@Injectable()
export class CommitmentSyncService {
  private readonly logger = new Logger(CommitmentSyncService.name);

  constructor(
    private readonly costExplorer: CostExplorerService,
    private readonly accounts: AwsAccountsService,
    private readonly analyzer: CommitmentAnalyzerService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async sync(account: AwsAccount, now = new Date()): Promise<CommitmentSyncDetails> {
    const empty = { potentialMonthlySavings: 0, created: 0, updated: 0, resolved: 0, skipped: 0 };
    try {
      const cached = account.commitments;
      const fresh = !!cached && now.getTime() - Date.parse(cached.fetchedAt) < COMMITMENT_REFRESH_MS;
      const snapshot = fresh && cached ? cached : await this.fetch(account, now);
      if (!fresh) {
        await this.accounts.saveCommitments(account.id, snapshot);
        account.commitments = snapshot;
      }
      const { analyses, drafts } = this.analyzer.analyze({ awsAccountId: account.awsAccountId, snapshot, currency: DEFAULT_CURRENCY, now });
      const types = [
        ...(snapshot.unavailable.includes('savingsPlansRecommendation') ? [] : [RecommendationType.SAVINGS_PLAN_PURCHASE]),
        ...(snapshot.unavailable.includes('rdsReservationRecommendation') ? [] : [RecommendationType.RESERVED_INSTANCE_PURCHASE]),
      ];
      const own = drafts.filter((d) => types.includes(d.type));
      const sync = types.length ? await this.recommendations.syncDrafts(account, types, own, new Map(analyses.map((a) => [a.resourceId, a]))) : { created: 0, updated: 0, resolved: 0, skipped: 0 };
      const potential = round(own.reduce((s, d) => s + (d.estimatedMonthlySavings ?? 0), 0));
      this.logger.log({ msg: 'Commitments synced', awsAccountRef: account.id, fetched: !fresh, unavailable: snapshot.unavailable, potentialMonthlySavings: potential });
      return { fetched: !fresh, unavailable: snapshot.unavailable, ...sync, potentialMonthlySavings: potential };
    } catch (error) {
      const err = toAwsIntegrationError(error);
      this.logger.warn({ msg: 'Commitments sync failed', awsAccountRef: account.id, code: err.code, error: err.message });
      return { fetched: false, unavailable: [], ...empty, error: `${err.code}: ${err.message}` };
    }
  }

  private async fetch(account: AwsAccount, now: Date): Promise<CommitmentSnapshot> {
    const today = todayUtc();
    const end = toIsoDate(today);
    const start = toIsoDate(addDays(today, -COMMITMENT_WINDOW_DAYS));
    const unavailable: string[] = [];
    const safe = async <T>(name: string, call: () => Promise<T | null>): Promise<T | null> => {
      try {
        return await call();
      } catch (error) {
        const err = toAwsIntegrationError(error);
        if (err.code !== 'ACCESS_DENIED') throw err;
        unavailable.push(name);
        this.logger.warn({ msg: 'Cost Explorer commitment data not readable: update the read-only role', awsAccountRef: account.id, operation: name });
        return null;
      }
    };
    const oneYear = await safe('savingsPlansRecommendation', () => this.costExplorer.getSavingsPlanRecommendation(account, 'ONE_YEAR'));
    const threeYears = oneYear ? await safe('savingsPlansRecommendation3y', () => this.costExplorer.getSavingsPlanRecommendation(account, 'THREE_YEARS')) : null;
    return {
      fetchedAt: now.toISOString(),
      savingsPlans: { oneYear, threeYears },
      rdsReservations: await safe('rdsReservationRecommendation', () => this.costExplorer.getRdsReservationRecommendation(account, 'ONE_YEAR')),
      savingsPlansCoverage: await safe('savingsPlansCoverage', () => this.costExplorer.getSavingsPlansCoverage(account, start, end)),
      savingsPlansUtilization: await safe('savingsPlansUtilization', () => this.costExplorer.getSavingsPlansUtilization(account, start, end)),
      reservationUtilization: await safe('reservationUtilization', () => this.costExplorer.getReservationUtilization(account, start, end)),
      unavailable,
    };
  }
}
