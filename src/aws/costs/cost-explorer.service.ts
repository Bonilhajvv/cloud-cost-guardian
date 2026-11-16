import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageWithResourcesCommand,
  GetCostForecastCommand,
  GetReservationPurchaseRecommendationCommand,
  GetReservationUtilizationCommand,
  GetSavingsPlansCoverageCommand,
  GetSavingsPlansPurchaseRecommendationCommand,
  GetSavingsPlansUtilizationCommand,
  Granularity,
} from '@aws-sdk/client-cost-explorer';
import { Injectable } from '@nestjs/common';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { CostLine, CostForecast } from './interfaces/cost-line.interface';
import { CE_REGION, COMMITMENT_LOOKBACK, COMMITMENT_PAYMENT_OPTION, METRIC, EC2_COMPUTE_SERVICE, RDS_SERVICE_NAME } from './constants/cost-explorer.constant';
import {
  normalizeReservationRecommendation,
  normalizeReservationUtilization,
  normalizeSavingsPlanRecommendation,
  normalizeSavingsPlansCoverage,
  normalizeSavingsPlansUtilization,
} from './helpers/normalize-commitments.helper';
import {
  CommitmentTerm,
  ReservationRecommendation,
  ReservationUtilization,
  SavingsPlanRecommendation,
  SavingsPlansCoverage,
  SavingsPlansUtilization,
} from './interfaces/commitment.interface';
import { flatten } from './helpers/flatten-cost-results.helper';

@Injectable()
export class CostExplorerService {
  constructor(private readonly clients: AwsClientFactory) {}

  async getCostByService(
    account: AwsAccountRef,
    start: string,
    end: string,
    granularity: 'DAILY' | 'MONTHLY',
  ): Promise<CostLine[]> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    const lines: CostLine[] = [];
    try {
      let NextPageToken: string | undefined;
      do {
        const page = await client.send(
          new GetCostAndUsageCommand({
            TimePeriod: { Start: start, End: end },
            Granularity: granularity === 'DAILY' ? Granularity.DAILY : Granularity.MONTHLY,
            Metrics: [METRIC],
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
            NextPageToken,
          }),
        );
        lines.push(...flatten(page.ResultsByTime ?? [], 'service'));
        NextPageToken = page.NextPageToken;
      } while (NextPageToken);
    } catch (error) {
      throw toAwsIntegrationError(error, 'GetCostAndUsage');
    }
    return lines;
  }

  async getCostByResource(
    account: AwsAccountRef,
    start: string,
    end: string,
    service: string = EC2_COMPUTE_SERVICE,
  ): Promise<CostLine[]> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    const lines: CostLine[] = [];
    try {
      let NextPageToken: string | undefined;
      do {
        const page = await client.send(
          new GetCostAndUsageWithResourcesCommand({
            TimePeriod: { Start: start, End: end },
            Granularity: Granularity.DAILY,
            Metrics: [METRIC],
            Filter: { Dimensions: { Key: 'SERVICE', Values: [service] } },
            GroupBy: [{ Type: 'DIMENSION', Key: 'RESOURCE_ID' }],
            NextPageToken,
          }),
        );
        lines.push(
          ...flatten(page.ResultsByTime ?? [], 'resource').map((l) => ({ ...l, service })),
        );
        NextPageToken = page.NextPageToken;
      } while (NextPageToken);
    } catch (error) {
      throw toAwsIntegrationError(error, 'GetCostAndUsageWithResources');
    }
    return lines;
  }

  async getForecast(account: AwsAccountRef, start: string, end: string): Promise<CostForecast | null> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    try {
      const out = await client.send(
        new GetCostForecastCommand({
          TimePeriod: { Start: start, End: end },
          Metric: 'UNBLENDED_COST',
          Granularity: Granularity.MONTHLY,
        }),
      );
      if (!out.Total?.Amount) return null;
      return {
        periodStart: start,
        periodEnd: end,
        amount: Number(out.Total.Amount),
        currency: out.Total.Unit ?? 'USD',
      };
    } catch (error) {
      const err = toAwsIntegrationError(error, 'GetCostForecast');
      if (err.code === 'DATA_UNAVAILABLE' || err.code === 'INVALID_CONFIGURATION') return null;
      throw err;
    }
  }

  async getSavingsPlanRecommendation(account: AwsAccountRef, term: CommitmentTerm): Promise<SavingsPlanRecommendation | null> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    const out = await this.orNull('GetSavingsPlansPurchaseRecommendation', () =>
      client.send(
        new GetSavingsPlansPurchaseRecommendationCommand({
          SavingsPlansType: 'COMPUTE_SP',
          TermInYears: term,
          PaymentOption: COMMITMENT_PAYMENT_OPTION,
          LookbackPeriodInDays: COMMITMENT_LOOKBACK,
        }),
      ),
    );
    return out ? normalizeSavingsPlanRecommendation(out, term, COMMITMENT_PAYMENT_OPTION) : null;
  }

  async getRdsReservationRecommendation(account: AwsAccountRef, term: CommitmentTerm): Promise<ReservationRecommendation | null> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    const out = await this.orNull('GetReservationPurchaseRecommendation', () =>
      client.send(
        new GetReservationPurchaseRecommendationCommand({
          Service: RDS_SERVICE_NAME,
          TermInYears: term,
          PaymentOption: COMMITMENT_PAYMENT_OPTION,
          LookbackPeriodInDays: COMMITMENT_LOOKBACK,
        }),
      ),
    );
    return out ? normalizeReservationRecommendation(out, term, COMMITMENT_PAYMENT_OPTION) : null;
  }

  async getSavingsPlansCoverage(account: AwsAccountRef, start: string, end: string): Promise<SavingsPlansCoverage | null> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    const out = await this.orNull('GetSavingsPlansCoverage', () => client.send(new GetSavingsPlansCoverageCommand({ TimePeriod: { Start: start, End: end } })));
    return out ? normalizeSavingsPlansCoverage(out) : null;
  }

  async getSavingsPlansUtilization(account: AwsAccountRef, start: string, end: string): Promise<SavingsPlansUtilization | null> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    const out = await this.orNull('GetSavingsPlansUtilization', () => client.send(new GetSavingsPlansUtilizationCommand({ TimePeriod: { Start: start, End: end } })));
    return out ? normalizeSavingsPlansUtilization(out) : null;
  }

  async getReservationUtilization(account: AwsAccountRef, start: string, end: string): Promise<ReservationUtilization | null> {
    const client = await this.clients.createClient(CostExplorerClient, account, CE_REGION);
    const out = await this.orNull('GetReservationUtilization', () => client.send(new GetReservationUtilizationCommand({ TimePeriod: { Start: start, End: end } })));
    return out ? normalizeReservationUtilization(out) : null;
  }

  private async orNull<T>(operation: string, call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      const err = toAwsIntegrationError(error, operation);
      if (err.code === 'DATA_UNAVAILABLE') return null;
      throw err;
    }
  }
}
