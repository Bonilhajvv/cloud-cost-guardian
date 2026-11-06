import { Resource } from '@aws-sdk/client-resource-explorer-2';
import { parseArn } from '../../core/helpers/arn.helper';
import { AwsResourceData } from '../interfaces/aws-resource-data.interface';

export function normalizeResource(resource: Resource): AwsResourceData | null {
  if (!resource.Arn) return null;
  const arn = parseArn(resource.Arn);
  if (!arn) return null;
  const tags = extractTags(resource);
  const region = resource.Region || arn.region || undefined;
  return {
    arn: resource.Arn,
    resourceId: arn.resourceId,
    service: resource.Service ?? arn.service,
    resourceType: resource.ResourceType ?? `${arn.service}:unknown`,
    region,
    name: tags.Name,
    tags,
  };
}

export function extractTags(resource: Resource): Record<string, string> {
  const tags: Record<string, string> = {};
  const prop = resource.Properties?.find((p) => p.Name === 'tags');
  const data: unknown = prop?.Data;
  if (!Array.isArray(data)) return tags;
  for (const item of data) {
    if (typeof item === 'object' && item !== null) {
      const { Key, Value } = item as { Key?: unknown; Value?: unknown };
      if (typeof Key === 'string') tags[Key] = typeof Value === 'string' ? Value : '';
    }
  }
  return tags;
}
