import { EC2Client, paginateDescribeVolumes } from '@aws-sdk/client-ec2';
import { Injectable } from '@nestjs/common';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { normalizeVolume } from './helpers/normalize-volume.helper';
import { EbsVolume } from './interfaces/ebs-volume.interface';

@Injectable()
export class EbsService {
  constructor(private readonly clients: AwsClientFactory) {}

  async listVolumes(account: AwsAccountRef, region: string): Promise<EbsVolume[]> {
    const client = await this.clients.createClient(EC2Client, account, region);
    const out: EbsVolume[] = [];
    try {
      for await (const page of paginateDescribeVolumes({ client }, { MaxResults: 500 })) {
        for (const v of page.Volumes ?? []) {
          const normalized = normalizeVolume(v, region, account.awsAccountId);
          if (normalized) out.push(normalized);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeVolumes ${region}`);
    }
    return out;
  }
}
