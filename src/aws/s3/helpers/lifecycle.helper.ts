import { LifecycleRule } from '@aws-sdk/client-s3';
import { S3LifecycleSummary } from '../interfaces/s3.interface';

export const EMPTY_LIFECYCLE: S3LifecycleSummary = { transitions: false, currentExpiration: false, noncurrentRules: false, abortsIncompleteUploads: false };

export function summarizeLifecycle(rules: readonly LifecycleRule[]): S3LifecycleSummary {
  const enabled = rules.filter((r) => r.Status === 'Enabled');
  return {
    transitions: enabled.some((r) => (r.Transitions ?? []).length > 0),
    currentExpiration: enabled.some((r) => r.Expiration?.Days !== undefined || r.Expiration?.Date !== undefined),
    noncurrentRules: enabled.some((r) => r.NoncurrentVersionExpiration !== undefined || (r.NoncurrentVersionTransitions ?? []).length > 0),
    abortsIncompleteUploads: enabled.some((r) => r.AbortIncompleteMultipartUpload?.DaysAfterInitiation !== undefined),
  };
}
