import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { AwsAccountRef } from './interfaces/aws-account-ref.interface';
import { AwsIntegrationError, toAwsIntegrationError } from './errors/aws-integration.error';
import { TemporaryCredentials } from './interfaces/temporary-credentials.interface';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

@Injectable()
export class AwsCredentialsService {
  private readonly logger = new Logger(AwsCredentialsService.name);
  private readonly cache = new Map<string, TemporaryCredentials>();
  private readonly inFlight = new Map<string, Promise<TemporaryCredentials>>();
  private readonly sts: STSClient;
  private readonly durationSeconds: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.sts = new STSClient({
      region: config.get('AWS_REGION', { infer: true }),
      maxAttempts: config.get('AWS_MAX_ATTEMPTS', { infer: true }),
    });
    this.durationSeconds = config.get('AWS_ASSUME_ROLE_DURATION_SECONDS', { infer: true });
  }

  async getCredentials(account: AwsAccountRef): Promise<TemporaryCredentials> {
    const key = this.cacheKey(account);
    const cached = this.cache.get(key);
    if (cached && cached.expiration.getTime() - Date.now() > REFRESH_MARGIN_MS) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.assumeRole(account)
      .then((creds) => {
        this.cache.set(key, creds);
        return creds;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async assumeRole(
    account: AwsAccountRef,
    externalId: string | null = account.externalId,
  ): Promise<TemporaryCredentials> {
    if (!account.roleArn) {
      throw new AwsIntegrationError('INVALID_CONFIGURATION', 'AWS account has no roleArn configured');
    }
    try {
      const { Credentials } = await this.sts.send(
        new AssumeRoleCommand({
          RoleArn: account.roleArn,
          RoleSessionName: `ccg-${account.id.slice(0, 8)}-${Date.now()}`,
          ExternalId: externalId ?? undefined,
          DurationSeconds: this.durationSeconds,
        }),
      );
      if (
        !Credentials?.AccessKeyId ||
        !Credentials.SecretAccessKey ||
        !Credentials.SessionToken ||
        !Credentials.Expiration
      ) {
        throw new AwsIntegrationError('UNKNOWN', 'STS returned incomplete credentials');
      }
      this.logger.log({
        msg: 'Assumed customer role',
        awsAccountRef: account.id,
        organizationId: account.organizationId,
        withExternalId: externalId !== null,
        expiresAt: Credentials.Expiration.toISOString(),
      });
      return {
        accessKeyId: Credentials.AccessKeyId,
        secretAccessKey: Credentials.SecretAccessKey,
        sessionToken: Credentials.SessionToken,
        expiration: Credentials.Expiration,
      };
    } catch (error) {
      const err = toAwsIntegrationError(error, 'AssumeRole failed');
      if (externalId !== null) {
        this.logger.warn({
          msg: 'AssumeRole failed',
          awsAccountRef: account.id,
          organizationId: account.organizationId,
          code: err.code,
          awsErrorName: err.awsErrorName,
        });
      }
      throw err;
    }
  }

  invalidate(account: AwsAccountRef): void {
    this.cache.delete(this.cacheKey(account));
  }

  private cacheKey(account: AwsAccountRef): string {
    return `${account.id}|${account.roleArn}|${account.externalId}`;
  }
}
