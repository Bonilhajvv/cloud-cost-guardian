import { Module } from '@nestjs/common';
import { AwsClientFactory } from './aws-client.factory';
import { AwsConnectionService } from './aws-connection.service';
import { AwsCredentialsService } from './aws-credentials.service';

@Module({
  providers: [AwsCredentialsService, AwsClientFactory, AwsConnectionService],
  exports: [AwsCredentialsService, AwsClientFactory, AwsConnectionService],
})
export class AwsCoreModule {}
