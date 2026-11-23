import { EC2Client, paginateDescribeImages, paginateDescribeSnapshots } from '@aws-sdk/client-ec2';
import { RDSClient, paginateDescribeDBSnapshots } from '@aws-sdk/client-rds';
import { Injectable } from '@nestjs/common';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { normalizeEbsSnapshot, normalizeRdsSnapshot } from './helpers/normalize-snapshot.helper';
import { EbsSnapshot, RdsSnapshot } from './interfaces/snapshot.interface';

@Injectable()
export class SnapshotsService {
  constructor(private readonly clients: AwsClientFactory) {}

  async amiBySnapshot(account: AwsAccountRef, region: string): Promise<Map<string, string>> {
    const client = await this.clients.createClient(EC2Client, account, region);
    const out = new Map<string, string>();
    try {
      for await (const page of paginateDescribeImages({ client }, { Owners: ['self'], IncludeDeprecated: true, IncludeDisabled: true })) {
        for (const image of page.Images ?? []) {
          for (const mapping of image.BlockDeviceMappings ?? []) {
            if (image.ImageId && mapping.Ebs?.SnapshotId) out.set(mapping.Ebs.SnapshotId, image.ImageId);
          }
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeImages ${region}`);
    }
    return out;
  }

  async listEbsSnapshots(account: AwsAccountRef, region: string, amiBySnapshot: ReadonlyMap<string, string>): Promise<EbsSnapshot[]> {
    const client = await this.clients.createClient(EC2Client, account, region);
    const out: EbsSnapshot[] = [];
    try {
      for await (const page of paginateDescribeSnapshots({ client }, { OwnerIds: ['self'] })) {
        for (const s of page.Snapshots ?? []) {
          const normalized = normalizeEbsSnapshot(s, region, amiBySnapshot);
          if (normalized) out.push(normalized);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeSnapshots ${region}`);
    }
    return out;
  }

  async listRdsSnapshots(account: AwsAccountRef, region: string): Promise<RdsSnapshot[]> {
    const client = await this.clients.createClient(RDSClient, account, region);
    const out: RdsSnapshot[] = [];
    try {
      for await (const page of paginateDescribeDBSnapshots({ client }, { SnapshotType: 'manual', MaxRecords: 100 })) {
        for (const s of page.DBSnapshots ?? []) {
          const normalized = normalizeRdsSnapshot(s, region);
          if (normalized) out.push(normalized);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeDBSnapshots ${region}`);
    }
    return out;
  }
}
