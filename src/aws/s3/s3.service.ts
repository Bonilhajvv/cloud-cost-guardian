import {
  GetBucketLifecycleConfigurationCommand,
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { chunk } from '../../common/helpers/stats.helper';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { DAY_MS } from '../rds/constants/rds.constant';
import { S3_CONCURRENCY, S3_DEFAULT_REGION, S3_STALE_UPLOAD_DAYS } from './constants/s3.constant';
import { EMPTY_LIFECYCLE, summarizeLifecycle } from './helpers/lifecycle.helper';
import { S3Bucket, S3Discovery } from './interfaces/s3.interface';

@Injectable()
export class S3Service {
  constructor(private readonly clients: AwsClientFactory) {}

  async listBuckets(account: AwsAccountRef): Promise<string[]> {
    const client = await this.clients.createClient(S3Client, account, S3_DEFAULT_REGION);
    try {
      const { Buckets } = await client.send(new ListBucketsCommand({}));
      return (Buckets ?? []).flatMap((b) => (b.Name ? [b.Name] : []));
    } catch (error) {
      throw toAwsIntegrationError(error, 'ListBuckets');
    }
  }

  async describeBuckets(account: AwsAccountRef, names: readonly string[], now: Date): Promise<S3Discovery> {
    const out: S3Discovery = { buckets: [], unreadable: [] };
    for (const batch of chunk(names, S3_CONCURRENCY)) {
      const results = await Promise.all(batch.map((name) => this.describe(account, name, now)));
      results.forEach((bucket, i) => (bucket ? out.buckets.push(bucket) : out.unreadable.push(batch[i])));
    }
    return out;
  }

  private async describe(account: AwsAccountRef, name: string, now: Date): Promise<S3Bucket | null> {
    const owner = { Bucket: name, ExpectedBucketOwner: account.awsAccountId };
    try {
      const global = await this.clients.createClient(S3Client, account, S3_DEFAULT_REGION);
      const { LocationConstraint } = await global.send(new GetBucketLocationCommand(owner));
      const region = !LocationConstraint ? S3_DEFAULT_REGION : LocationConstraint === 'EU' ? 'eu-west-1' : String(LocationConstraint);
      const client = await this.clients.createClient(S3Client, account, region);
      const versioning = await client.send(new GetBucketVersioningCommand(owner));
      return {
        name,
        arn: `arn:aws:s3:::${name}`,
        region,
        versioned: versioning.Status !== undefined,
        lifecycle: await this.lifecycle(client, owner),
        staleUploads: await this.staleUploads(client, owner, now),
      };
    } catch (error) {
      const err = toAwsIntegrationError(error, `Describe bucket ${name}`);
      if (err.code === 'ACCESS_DENIED' || err.awsErrorName === 'NoSuchBucket') return null;
      throw err;
    }
  }

  private async lifecycle(client: S3Client, owner: { Bucket: string; ExpectedBucketOwner: string }) {
    try {
      const { Rules } = await client.send(new GetBucketLifecycleConfigurationCommand(owner));
      return summarizeLifecycle(Rules ?? []);
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchLifecycleConfiguration') return EMPTY_LIFECYCLE;
      throw error;
    }
  }

  private async staleUploads(client: S3Client, owner: { Bucket: string; ExpectedBucketOwner: string }, now: Date): Promise<number | null> {
    try {
      const { Uploads } = await client.send(new ListMultipartUploadsCommand(owner));
      const limit = now.getTime() - S3_STALE_UPLOAD_DAYS * DAY_MS;
      return (Uploads ?? []).filter((u) => u.Initiated && u.Initiated.getTime() < limit).length;
    } catch (error) {
      if (toAwsIntegrationError(error).code === 'ACCESS_DENIED') return null;
      throw error;
    }
  }
}
