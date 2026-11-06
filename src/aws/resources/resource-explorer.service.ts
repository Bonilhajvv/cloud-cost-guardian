import {
  IndexType,
  paginateListIndexes,
  paginateListResources,
  ResourceExplorer2Client,
} from '@aws-sdk/client-resource-explorer-2';
import { Injectable, Logger } from '@nestjs/common';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { forEachRegion } from '../core/helpers/region-runner.helper';
import { AwsResourceData, DiscoveryResult } from './interfaces/aws-resource-data.interface';
import { normalizeResource } from './helpers/normalize-resource.helper';

@Injectable()
export class ResourceExplorerService {
  private readonly logger = new Logger(ResourceExplorerService.name);

  constructor(private readonly clients: AwsClientFactory) {}

  async discover(account: AwsAccountRef, filterString?: string): Promise<DiscoveryResult> {
    const indexes = await this.listIndexes(account);
    if (indexes.length === 0) return { mode: 'UNAVAILABLE', resources: [], failures: [] };

    const aggregator = indexes.find((i) => i.type === IndexType.AGGREGATOR);
    const regions = aggregator ? [aggregator.region] : indexes.map((i) => i.region);
    const run = await forEachRegion(regions, (region) =>
      this.listResources(account, region, filterString),
    );

    const byArn = new Map<string, AwsResourceData>();
    for (const { value } of run.results) for (const r of value) byArn.set(r.arn, r);

    if (run.failures.length) {
      this.logger.warn({ msg: 'Resource Explorer region failures', failures: run.failures });
    }
    return {
      mode: aggregator ? 'AGGREGATOR' : 'LOCAL',
      resources: [...byArn.values()],
      failures: run.failures,
    };
  }

  private async listIndexes(account: AwsAccountRef): Promise<{ region: string; type: string }[]> {
    try {
      const client = await this.clients.createClient(ResourceExplorer2Client, account);
      const out: { region: string; type: string }[] = [];
      for await (const page of paginateListIndexes({ client }, {})) {
        for (const index of page.Indexes ?? []) {
          if (index.Region && index.Type) out.push({ region: index.Region, type: index.Type });
        }
      }
      return out;
    } catch (error) {
      const err = toAwsIntegrationError(error, 'ListIndexes');
      if (err.code === 'ACCESS_DENIED') throw err;
      this.logger.warn({ msg: 'Resource Explorer unavailable', error: err.message });
      return [];
    }
  }

  private async listResources(
    account: AwsAccountRef,
    region: string,
    filterString?: string,
  ): Promise<AwsResourceData[]> {
    const client = await this.clients.createClient(ResourceExplorer2Client, account, region);
    const out: AwsResourceData[] = [];
    const input = filterString ? { Filters: { FilterString: filterString } } : {};
    for await (const page of paginateListResources({ client }, input)) {
      for (const resource of page.Resources ?? []) {
        const normalized = normalizeResource(resource);
        if (normalized) out.push(normalized);
      }
    }
    return out;
  }
}

