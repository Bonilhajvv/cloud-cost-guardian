import { RegionFailure } from '../../core/interfaces/region-run-result.interface';

export interface AwsResourceData {
  arn: string;
  resourceId: string;
  service: string;
  resourceType: string;
  region?: string;
  name?: string;
  tags: Record<string, string>;
}

export type DiscoveryMode = 'AGGREGATOR' | 'LOCAL' | 'UNAVAILABLE';

export interface DiscoveryResult {
  mode: DiscoveryMode;
  resources: AwsResourceData[];
  failures: RegionFailure[];
}
