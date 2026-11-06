import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { AwsAccountRef } from './interfaces/aws-account-ref.interface';
import { AwsCredentialsService } from './aws-credentials.service';
import { AwsClientConstructor } from './interfaces/aws-client-config.interface';

@Injectable()
export class AwsClientFactory {
  private readonly maxAttempts: number;

  constructor(
    private readonly credentials: AwsCredentialsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxAttempts = config.get('AWS_MAX_ATTEMPTS', { infer: true });
  }

  async createClient<T>(
    ClientClass: AwsClientConstructor<T>,
    account: AwsAccountRef,
    region: string = account.defaultRegion,
  ): Promise<T> {
    await this.credentials.getCredentials(account);
    return new ClientClass({
      region,
      credentials: () => this.credentials.getCredentials(account),
      maxAttempts: this.maxAttempts,
      retryMode: 'adaptive',
    });
  }
}
