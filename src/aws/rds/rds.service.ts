import { RDSClient, paginateDescribeDBInstances, paginateDescribeDBMajorEngineVersions } from '@aws-sdk/client-rds';
import { Injectable } from '@nestjs/common';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { EXTENDED_SUPPORT, STANDARD_SUPPORT } from './constants/rds.constant';
import { normalizeRdsInstance } from './helpers/normalize-rds-instance.helper';
import { RdsEngineLifecycle, RdsInstance } from './interfaces/rds-instance.interface';

@Injectable()
export class RdsService {
  constructor(private readonly clients: AwsClientFactory) {}

  async listInstances(account: AwsAccountRef, region: string): Promise<RdsInstance[]> {
    const client = await this.clients.createClient(RDSClient, account, region);
    const out: RdsInstance[] = [];
    try {
      for await (const page of paginateDescribeDBInstances({ client }, { MaxRecords: 100 })) {
        for (const db of page.DBInstances ?? []) {
          const normalized = normalizeRdsInstance(db, region);
          if (normalized) out.push(normalized);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeDBInstances ${region}`);
    }
    return out;
  }

  async engineLifecycles(account: AwsAccountRef, region: string, engines: readonly string[]): Promise<RdsEngineLifecycle[]> {
    const client = await this.clients.createClient(RDSClient, account, region);
    const out: RdsEngineLifecycle[] = [];
    try {
      for (const engine of new Set(engines)) {
        for await (const page of paginateDescribeDBMajorEngineVersions({ client }, { Engine: engine })) {
          for (const v of page.DBMajorEngineVersions ?? []) {
            if (!v.Engine || !v.MajorEngineVersion) continue;
            const end = (name: string) => v.SupportedEngineLifecycles?.find((l) => l.LifecycleSupportName === name)?.LifecycleSupportEndDate?.toISOString() ?? null;
            out.push({ engine: v.Engine, majorVersion: v.MajorEngineVersion, standardSupportEnd: end(STANDARD_SUPPORT), extendedSupportEnd: end(EXTENDED_SUPPORT) });
          }
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeDBMajorEngineVersions ${region}`);
    }
    return out;
  }
}
