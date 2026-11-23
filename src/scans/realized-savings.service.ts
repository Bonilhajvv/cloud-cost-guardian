import { Injectable, Logger } from '@nestjs/common';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { CostUsageService } from '../cost-reports/cost-usage.service';
import { measureRealizedSavings, usageKeysOf } from '../recommendations/helpers/realized-savings.helper';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { RealizedSavingsDetails } from './interfaces/scan-report.interface';

@Injectable()
export class RealizedSavingsService {
  private readonly logger = new Logger(RealizedSavingsService.name);

  constructor(
    private readonly usage: CostUsageService,
    private readonly recommendations: RecommendationsService,
    private readonly accounts: AwsAccountsService,
  ) {}

  async sync(account: AwsAccount, now = new Date()): Promise<RealizedSavingsDetails> {
    const { state, syncedPeriods, rows } = await this.usage.sync(account, now);
    await this.accounts.saveCostExport(account.id, state);
    account.costExport = state;
    const details: RealizedSavingsDetails = { status: state.status, syncedPeriods, rows, measured: 0, pending: 0, notMeasurable: 0 };
    if (state.status !== 'OK') return details;
    const coveredDays = await this.usage.coveredDays(account.id);
    const implemented = (await this.recommendations.findMeasurable(account.id, now)).flatMap((rec) => (rec.implementedAt ? [{ rec, implementedAt: rec.implementedAt, keys: usageKeysOf(rec) }] : []));
    for (const { rec, implementedAt, keys } of implemented) {
      if (rec.metadata.realizedMeasurement?.final) continue;
      const measurement = measureRealizedSavings({
        type: rec.type,
        implementedAt,
        otherChanges: implemented.filter((o) => o.rec !== rec && o.keys.some((k) => keys.includes(k))).map((o) => o.implementedAt),
        coveredDays,
        usage: await this.usage.dailyUsage(account.id, keys),
        now,
      });
      await this.recommendations.saveMeasurement(rec, measurement);
      if (measurement.status === 'MEASURED') details.measured++;
      else if (measurement.status === 'PENDING') details.pending++;
      else details.notMeasurable++;
    }
    this.logger.log({ msg: 'Realized savings measured', awsAccountRef: account.id, ...details });
    return details;
  }
}
