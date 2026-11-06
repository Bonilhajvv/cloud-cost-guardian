import { READ_ONLY_ACTIONS } from '../constants/aws-account.constant';

export function buildTrustPolicy(platformAccountId: string, externalId: string): Record<string, unknown> {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${platformAccountId}:root` },
        Action: 'sts:AssumeRole',
        Condition: { StringEquals: { 'sts:ExternalId': externalId } },
      },
    ],
  };
}

export function buildPermissionsPolicy(): Record<string, unknown> {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'CloudCostGuardianReadOnly',
        Effect: 'Allow',
        Action: [...READ_ONLY_ACTIONS],
        Resource: '*',
      },
    ],
  };
}
