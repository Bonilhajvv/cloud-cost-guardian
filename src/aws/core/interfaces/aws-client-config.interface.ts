import { TemporaryCredentials } from './temporary-credentials.interface';

export interface AwsClientConfig {
  region: string;
  credentials: () => Promise<TemporaryCredentials>;
  maxAttempts: number;
  retryMode: 'adaptive';
}

export type AwsClientConstructor<T> = new (config: AwsClientConfig) => T;
