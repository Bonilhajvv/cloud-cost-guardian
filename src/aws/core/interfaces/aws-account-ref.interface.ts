import { AwsAccount } from '../../../aws-accounts/entities/aws-account.entity';

export type AwsAccountRef = Pick<
  AwsAccount,
  'id' | 'organizationId' | 'awsAccountId' | 'roleArn' | 'externalId' | 'defaultRegion'
>;
