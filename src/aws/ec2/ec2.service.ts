import {
  DescribeRegionsCommand,
  EC2Client,
  Filter,
  Instance,
  paginateDescribeInstances,
  paginateDescribeInstanceTypes,
} from '@aws-sdk/client-ec2';
import { Injectable } from '@nestjs/common';
import { chunk } from '../../common/helpers/stats.helper';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { Ec2InstanceDetails, InstanceTypeSpec } from './interfaces/ec2-instance.interface';
import { isString, normalizeInstance } from './helpers/normalize-instance.helper';

@Injectable()
export class Ec2Service {
  constructor(private readonly clients: AwsClientFactory) {}

  async listInstances(
    account: AwsAccountRef,
    region: string,
    instanceIds?: readonly string[],
  ): Promise<Ec2InstanceDetails[]> {
    const client = await this.clients.createClient(EC2Client, account, region);
    const filterSets: Filter[][] = instanceIds?.length
      ? chunk(instanceIds, 200).map((ids) => [{ Name: 'instance-id', Values: ids }])
      : [[]];

    const raw: { instance: Instance; ownerId: string }[] = [];
    try {
      for (const Filters of filterSets) {
        for await (const page of paginateDescribeInstances(
          { client },
          { Filters: Filters.length ? Filters : undefined, MaxResults: 1000 },
        )) {
          for (const reservation of page.Reservations ?? []) {
            for (const instance of reservation.Instances ?? []) {
              raw.push({ instance, ownerId: reservation.OwnerId ?? account.awsAccountId });
            }
          }
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeInstances ${region}`);
    }

    const types = [...new Set(raw.map((r) => r.instance.InstanceType).filter(isString))];
    const specs = await this.describeInstanceTypes(account, region, types);
    return raw
      .map(({ instance, ownerId }) => normalizeInstance(instance, region, ownerId, specs))
      .filter((i): i is Ec2InstanceDetails => i !== null);
  }

  async getInstance(
    account: AwsAccountRef,
    region: string,
    instanceId: string,
  ): Promise<Ec2InstanceDetails | null> {
    const [instance] = await this.listInstances(account, region, [instanceId]);
    return instance ?? null;
  }

  async describeInstanceTypes(
    account: AwsAccountRef,
    region: string,
    instanceTypes: readonly string[],
  ): Promise<Map<string, InstanceTypeSpec>> {
    const specs = new Map<string, InstanceTypeSpec>();
    if (instanceTypes.length === 0) return specs;
    const client = await this.clients.createClient(EC2Client, account, region);
    try {
      for (const types of chunk(instanceTypes, 50)) {
        for await (const page of paginateDescribeInstanceTypes(
          { client },
          { Filters: [{ Name: 'instance-type', Values: types }] },
        )) {
          for (const t of page.InstanceTypes ?? []) {
            const vcpu = t.VCpuInfo?.DefaultVCpus;
            const memMiB = t.MemoryInfo?.SizeInMiB;
            if (!t.InstanceType || vcpu === undefined || memMiB === undefined) continue;
            specs.set(t.InstanceType, {
              instanceType: t.InstanceType,
              vcpu,
              memoryGiB: memMiB / 1024,
              architectures: t.ProcessorInfo?.SupportedArchitectures ?? [],
            });
          }
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeInstanceTypes ${region}`);
    }
    return specs;
  }

  async listEnabledRegions(account: AwsAccountRef): Promise<string[]> {
    const client = await this.clients.createClient(EC2Client, account);
    try {
      const { Regions } = await client.send(new DescribeRegionsCommand({ AllRegions: false }));
      return (Regions ?? []).map((r) => r.RegionName).filter(isString);
    } catch (error) {
      throw toAwsIntegrationError(error, 'DescribeRegions');
    }
  }
}

