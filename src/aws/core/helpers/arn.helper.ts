import { ParsedArn } from '../interfaces/parsed-arn.interface';
export function parseArn(arn: string): ParsedArn | null {
  const parts = arn.split(':');
  if (parts.length < 6 || parts[0] !== 'arn') return null;
  const [, partition, service, region, accountId, ...rest] = parts;
  const resource = rest.join(':');
  const segments = resource.split(/[/:]/);
  return {
    partition,
    service,
    region,
    accountId,
    resource,
    resourceId: segments[segments.length - 1] || resource,
  };
}

export function partitionForRegion(region: string): string {
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  return 'aws';
}
