import { FunctionConfiguration, LambdaClient, paginateListFunctions, paginateListProvisionedConcurrencyConfigs } from '@aws-sdk/client-lambda';
import { Injectable } from '@nestjs/common';
import { chunk } from '../../common/helpers/stats.helper';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { LAMBDA_CONCURRENCY } from './constants/lambda.constant';
import { LambdaFunction } from './interfaces/lambda.interface';

@Injectable()
export class LambdaService {
  constructor(private readonly clients: AwsClientFactory) {}

  async listFunctions(account: AwsAccountRef, region: string): Promise<LambdaFunction[]> {
    const client = await this.clients.createClient(LambdaClient, account, region);
    const out: LambdaFunction[] = [];
    try {
      for await (const page of paginateListFunctions({ client }, {})) {
        for (const f of page.Functions ?? []) {
          const normalized = this.normalize(f, region);
          if (normalized) out.push(normalized);
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `ListFunctions ${region}`);
    }
    return out;
  }

  async provisionedConcurrency(account: AwsAccountRef, region: string, functionNames: readonly string[]): Promise<Map<string, { qualifier: string; allocated: number }[]>> {
    const client = await this.clients.createClient(LambdaClient, account, region);
    const out = new Map<string, { qualifier: string; allocated: number }[]>();
    try {
      for (const batch of chunk(functionNames, LAMBDA_CONCURRENCY)) {
        await Promise.all(
          batch.map(async (name) => {
            for await (const page of paginateListProvisionedConcurrencyConfigs({ client }, { FunctionName: name })) {
              for (const c of page.ProvisionedConcurrencyConfigs ?? []) {
                const qualifier = c.FunctionArn?.split(':')[7];
                const allocated = c.AllocatedProvisionedConcurrentExecutions ?? 0;
                if (qualifier && allocated > 0) out.set(name, [...(out.get(name) ?? []), { qualifier, allocated }]);
              }
            }
          }),
        );
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `ListProvisionedConcurrencyConfigs ${region}`);
    }
    return out;
  }

  private normalize(f: FunctionConfiguration, region: string): LambdaFunction | null {
    if (!f.FunctionName || !f.FunctionArn || !f.MemorySize) return null;
    return {
      functionName: f.FunctionName,
      arn: f.FunctionArn,
      region,
      runtime: f.Runtime ?? null,
      packageType: f.PackageType ?? 'Zip',
      architecture: f.Architectures?.[0] === 'arm64' ? 'arm64' : 'x86_64',
      memoryMb: f.MemorySize,
    };
  }
}
