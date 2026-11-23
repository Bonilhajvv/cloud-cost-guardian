import { AwsAccountRef } from '../../core/interfaces/aws-account-ref.interface';

export interface EksClusterAccess {
  account: AwsAccountRef;
  clusterName: string;
  region: string;
  endpoint: string;
  ca: string;
}

export interface KubeListPage<T> {
  metadata?: { continue?: string };
  items?: T[];
}
