import { CostExplorerClient, GetCostAndUsageCommand, GetCostAndUsageWithResourcesCommand, GetCostForecastCommand, Granularity } from '@aws-sdk/client-cost-explorer';
import { Injectable } from '@nestjs/common';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { CostLine, CostForecast } from './interfaces/cost-line.interface';
import { CE_REGION, METRIC, EC2_COMPUTE_SERVICE } from './constants/cost-explorer.constant';
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
}

