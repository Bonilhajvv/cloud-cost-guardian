import {
  DescribeAddressesCommand,
  EC2Client,
  NetworkInterface,
  paginateDescribeNatGateways,
  paginateDescribeNetworkInterfaces,
  paginateDescribeVpcEndpoints,
} from '@aws-sdk/client-ec2';
import { ElasticLoadBalancingV2Client, paginateDescribeLoadBalancers } from '@aws-sdk/client-elastic-load-balancing-v2';
import { Injectable } from '@nestjs/common';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { GATEWAY_ENDPOINT_SERVICES } from './constants/network.constant';
import { normalizeElasticIp, normalizeLoadBalancer, normalizeNatGateway } from './helpers/normalize-network.helper';
import { ElasticIp, LoadBalancer, NatGateway } from './interfaces/network.interface';

@Injectable()
export class NetworkService {
  constructor(private readonly clients: AwsClientFactory) {}

  async listElasticIps(account: AwsAccountRef, region: string): Promise<ElasticIp[]> {
    const client = await this.clients.createClient(EC2Client, account, region);
    try {
      const out = await client.send(new DescribeAddressesCommand({}));
      return (out.Addresses ?? []).map((a) => normalizeElasticIp(a, region)).filter((a): a is ElasticIp => a !== null);
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeAddresses ${region}`);
    }
  }

  async listNatGateways(account: AwsAccountRef, region: string): Promise<NatGateway[]> {
    const client = await this.clients.createClient(EC2Client, account, region);
    const out: NatGateway[] = [];
    try {
      for await (const page of paginateDescribeNatGateways({ client }, {})) {
        for (const n of page.NatGateways ?? []) {
          const normalized = normalizeNatGateway(n, region);
          if (normalized) out.push(normalized);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeNatGateways ${region}`);
    }
    return out;
  }

  async gatewayEndpointsByVpc(account: AwsAccountRef, region: string): Promise<Map<string, string[]>> {
    const client = await this.clients.createClient(EC2Client, account, region);
    const out = new Map<string, string[]>();
    try {
      for await (const page of paginateDescribeVpcEndpoints({ client }, { Filters: [{ Name: 'vpc-endpoint-type', Values: ['Gateway'] }] })) {
        for (const e of page.VpcEndpoints ?? []) {
          const service = e.ServiceName?.split('.').pop();
          if (!e.VpcId || !service || !GATEWAY_ENDPOINT_SERVICES.includes(service)) continue;
          out.set(e.VpcId, [...(out.get(e.VpcId) ?? []), service]);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeVpcEndpoints ${region}`);
    }
    return out;
  }

  async publicNetworkInterfaces(account: AwsAccountRef, region: string): Promise<NetworkInterface[]> {
    const client = await this.clients.createClient(EC2Client, account, region);
    const out: NetworkInterface[] = [];
    try {
      for await (const page of paginateDescribeNetworkInterfaces({ client }, { Filters: [{ Name: 'association.public-ip', Values: ['*'] }] })) {
        out.push(...(page.NetworkInterfaces ?? []));
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeNetworkInterfaces ${region}`);
    }
    return out;
  }

  async listLoadBalancers(account: AwsAccountRef, region: string): Promise<LoadBalancer[]> {
    const client = await this.clients.createClient(ElasticLoadBalancingV2Client, account, region);
    const out: LoadBalancer[] = [];
    try {
      for await (const page of paginateDescribeLoadBalancers({ client }, {})) {
        for (const lb of page.LoadBalancers ?? []) {
          const normalized = normalizeLoadBalancer(lb, region);
          if (normalized) out.push(normalized);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeLoadBalancers ${region}`);
    }
    return out;
  }
}
