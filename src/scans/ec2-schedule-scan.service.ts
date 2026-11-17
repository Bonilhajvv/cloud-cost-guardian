import { Injectable, Logger } from '@nestjs/common';
import { isEc2Analysis } from '../aws/core/helpers/resource-analysis.helper';
import { RecommendationDraft, ResourceAnalysis } from '../aws/core/interfaces/recommendation-draft.interface';
import { scheduleDraft } from '../aws/ec2/helpers/schedule.helper';
import { Ec2InstanceDetails } from '../aws/ec2/interfaces/ec2-instance.interface';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { SCHEDULE_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { DEFAULT_CURRENCY } from './constants/scan.constant';
import { AnalysisDetails } from './interfaces/scan-report.interface';

@Injectable()
export class Ec2ScheduleScanService {
  private readonly logger = new Logger(Ec2ScheduleScanService.name);

  constructor(
    private readonly organizations: OrganizationsService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async analyze(account: AwsAccount, analyses: ReadonlyMap<string, ResourceAnalysis>, instances: ReadonlyMap<string, Ec2InstanceDetails>): Promise<Omit<AnalysisDetails, 'ebs' | 'rds' | 'network' | 'kubernetes' | 'schedule'>> {
    const schedule = await this.organizations.workSchedule(account.organizationId);
    const drafts: RecommendationDraft[] = [];
    const findings: Record<string, number> = {};
    for (const analysis of analyses.values()) {
      const instance = instances.get(analysis.resourceId);
      if (!instance || !isEc2Analysis(analysis)) continue;
      const env = analysis.environment?.environment ?? 'UNKNOWN';
      findings[env] = (findings[env] ?? 0) + 1;
      const draft = scheduleDraft(analysis, instance, schedule, DEFAULT_CURRENCY);
      if (draft) drafts.push(draft);
    }
    const sync = await this.recommendations.syncDrafts(account, SCHEDULE_RECOMMENDATION_TYPES, drafts, analyses);
    this.logger.log({ msg: 'EC2 schedule analysis finished', awsAccountRef: account.id, environments: findings, drafts: drafts.length, hoursPerWeek: schedule.hoursPerWeek });
    return { analyzed: analyses.size, findings, ...sync };
  }
}
