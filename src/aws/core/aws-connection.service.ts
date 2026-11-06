import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { Injectable, Logger } from '@nestjs/common';
import { AwsAccountRef } from './interfaces/aws-account-ref.interface';
import { AwsClientFactory } from './aws-client.factory';
import { AwsCredentialsService } from './aws-credentials.service';
import { toAwsIntegrationError } from './errors/aws-integration.error';
import { ConnectionTestResult } from './interfaces/connection-test-result.interface';

@Injectable()
export class AwsConnectionService {
  private readonly logger = new Logger(AwsConnectionService.name);

  constructor(
    private readonly credentials: AwsCredentialsService,
    private readonly clients: AwsClientFactory,
  ) {}

  async test(account: AwsAccountRef): Promise<ConnectionTestResult> {
    const result = await this.runTest(account);
    const log = {
      msg: 'AWS connection test',
      awsAccountRef: account.id,
      organizationId: account.organizationId,
      awsAccountId: account.awsAccountId,
      success: result.success,
      errorCode: result.errorCode,
      warnings: result.warnings,
    };
    if (result.success) this.logger.log(log);
    else this.logger.warn({ ...log, error: result.message });
    return result;
  }

  private async runTest(account: AwsAccountRef): Promise<ConnectionTestResult> {
    this.credentials.invalidate(account);
    try {
      const sts = await this.clients.createClient(STSClient, account);
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      if (identity.Account !== account.awsAccountId) {
        return {
          success: false,
          callerArn: identity.Arn ?? null,
          errorCode: 'INVALID_CONFIGURATION',
          message: `Role belongs to account ${identity.Account}, expected ${account.awsAccountId}`,
          warnings: [],
        };
      }
      return {
        success: true,
        callerArn: identity.Arn ?? null,
        errorCode: null,
        message: 'Connection established',
        warnings: await this.trustPolicyWarnings(account),
      };
    } catch (error) {
      const err = toAwsIntegrationError(error);
      return { success: false, callerArn: null, errorCode: err.code, message: err.message, warnings: [] };
    }
  }

  private async trustPolicyWarnings(account: AwsAccountRef): Promise<string[]> {
    try {
      await this.credentials.assumeRole(account, null);
      return ['Role trust policy does not require sts:ExternalId. Add the ExternalId condition.'];
    } catch {
      return [];
    }
  }
}
