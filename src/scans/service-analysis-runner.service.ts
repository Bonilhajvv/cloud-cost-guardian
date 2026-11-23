import { Injectable, Logger } from '@nestjs/common';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { RecommendationDraft, ResourceAnalysis } from '../aws/core/interfaces/recommendation-draft.interface';
import { ServiceAnalysisResult } from '../aws/core/interfaces/service-analysis.interface';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RecommendationType } from '../common/enums';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { ServiceAnalysisDetails } from './interfaces/scan-report.interface';

@Injectable()
export class ServiceAnalysisRunner {
  private readonly logger = new Logger(ServiceAnalysisRunner.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async analyze(
    account: AwsAccount,
    resourceType: string,
    types: readonly RecommendationType[],
    run: (resource: AwsResource) => ServiceAnalysisResult | null,
    relatedIds: (resource: AwsResource) => string[] = () => [],
  ): Promise<ServiceAnalysisDetails> {
    const drafts: RecommendationDraft[] = [];
    const analyses = new Map<string, ResourceAnalysis>();
    const findings: Record<string, number> = {};
    const unreadable = new Set<string>();
    let analyzed = 0;
    for (const resource of await this.inventory.findByType(account.id, resourceType)) {
      if (resource.metadata.unreadableSince) {
        for (const id of [resource.resourceId, resource.metadata.analysis?.resourceId ?? resource.arn, ...relatedIds(resource)]) unreadable.add(id);
        continue;
      }
      const result = run(resource);
      if (!result) continue;
      await this.inventory.patchMetadata(account.id, resourceType, resource.resourceId, { analysis: result.analysis });
      for (const id of [result.analysis.resourceId, ...relatedIds(resource)]) analyses.set(id, result.analysis);
      findings[result.analysis.finding] = (findings[result.analysis.finding] ?? 0) + 1;
      drafts.push(...result.drafts);
      analyzed++;
    }
    const sync = await this.recommendations.syncDrafts(account, types, drafts, analyses, unreadable);
    this.logger.log({ msg: 'Service analysis finished', awsAccountRef: account.id, resourceType, analyzed, findings, drafts: drafts.length });
    return { analyzed, findings, ...sync };
  }

  async readable<T>(account: AwsAccount, operation: string, unavailable: Set<string>, call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      const err = toAwsIntegrationError(error);
      if (err.code !== 'ACCESS_DENIED') throw err;
      if (!unavailable.has(operation)) this.logger.warn({ msg: 'AWS data not readable: update the read-only role', awsAccountRef: account.id, operation });
      unavailable.add(operation);
      return null;
    }
  }
}
