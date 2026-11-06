import { ComputeOptimizerClient, GetEC2InstanceRecommendationsCommand } from '@aws-sdk/client-compute-optimizer';
import { Injectable } from '@nestjs/common';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { Ec2OptimizerRecommendation, Ec2OptimizerResult } from './interfaces/ec2-optimizer.interface';
import { normalizeEc2Recommendation } from './helpers/normalize-ec2-recommendation.helper';

@Injectable()
export class ComputeOptimizerService {
  constructor(private readonly clients: AwsClientFactory) {}

  async getEc2Recommendations(account: AwsAccountRef, region: string): Promise<Ec2OptimizerResult> {
    const client = await this.clients.createClient(ComputeOptimizerClient, account, region);
    const recommendations: Ec2OptimizerRecommendation[] = [];
    try {
      let nextToken: string | undefined;
      do {
        const page = await client.send(
          new GetEC2InstanceRecommendationsCommand({ nextToken, maxResults: 1000 }),
        );
        for (const r of page.instanceRecommendations ?? []) {
          const normalized = normalizeEc2Recommendation(r);
          if (normalized) recommendations.push(normalized);
        }
        nextToken = page.nextToken;
      } while (nextToken);
    } catch (error) {
      const err = toAwsIntegrationError(error, `GetEC2InstanceRecommendations ${region}`);
      if (err.code === 'NOT_ENROLLED') return { availability: 'NOT_ENROLLED', recommendations: [] };
      if (err.code === 'ACCESS_DENIED') return { availability: 'ACCESS_DENIED', recommendations: [] };
      throw err;
    }
    return { availability: 'OK', recommendations };
  }
}

