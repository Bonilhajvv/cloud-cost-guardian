import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { round } from '../../../common/helpers/stats.helper';
import { HOURS_PER_WEEK } from '../../../organizations/constants/work-schedule.constant';
import { offHoursFraction, scheduleKey, scheduleWindow } from '../../../organizations/helpers/work-schedule.helper';
import { EffectiveWorkSchedule } from '../../../organizations/interfaces/work-schedule.interface';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';
import { AUTOSCALING_GROUP_TAG, MIN_SCHEDULE_MONTHLY_SAVINGS, SCHEDULER_TAG_KEYS } from '../constants/schedule.constant';
import { Ec2InstanceDetails } from '../interfaces/ec2-instance.interface';
import { Ec2Analysis } from '../interfaces/ec2-analysis.interface';
import { severityFor } from './risk-level.helper';

export function schedulerTag(tags: Record<string, string>): string | null {
  const key = Object.keys(tags).find((k) => SCHEDULER_TAG_KEYS.includes(k.toLowerCase()) && tags[k].trim() !== '');
  return key ? `${key}=${tags[key]}` : null;
}

export function scheduleDraft(analysis: Ec2Analysis, instance: Ec2InstanceDetails, schedule: EffectiveWorkSchedule, currency: string): RecommendationDraft | null {
  const env = analysis.environment;
  if (instance.state !== 'running' || env?.environment !== 'NON_PRODUCTION') return null;
  if (analysis.kubernetes || instance.tags[AUTOSCALING_GROUP_TAG] || analysis.scheduler) return null;
  const offFraction = offHoursFraction(schedule);
  if (offFraction <= 0) return null;
  const monthly = analysis.current.monthlyCost;
  const savings = monthly === null ? null : round(monthly * offFraction);
  if (savings !== null && savings < MIN_SCHEDULE_MONTHLY_SAVINGS) return null;

  const window = scheduleWindow(schedule);
  const reasons = [
    `Non-production instance (${env.detail})`,
    `Running only ${window} (${schedule.timezone}) is ${schedule.hoursPerWeek}h of ${HOURS_PER_WEEK}h per week, about ${Math.round(offFraction * 100)}% less instance cost`,
    'Use AWS Instance Scheduler or an EventBridge Scheduler rule to stop and start the instance, and tag it with the schedule name',
    'EBS volumes and Elastic IPs keep charging while the instance is stopped; only the instance hours are saved',
    'If a Reserved Instance or Savings Plan covers this instance, stopping it saves nothing until the commitment ends',
    'Confirm nothing runs outside business hours (batch jobs, backups, pipelines) and that no instance store data must survive a stop',
  ];
  const recommendation = {
    type: RecommendationType.EC2_SCHEDULE,
    source: RecommendationSource.CCG_HEURISTIC,
    instanceType: analysis.current.instanceType,
    vcpu: analysis.current.vcpu,
    memoryGb: analysis.current.memoryGb,
    performanceRisk: Level.LOW,
    confidence: env.source === 'NAME' ? Level.MEDIUM : Level.HIGH,
    reasons,
  };
  const draftAnalysis: Ec2Analysis = {
    ...analysis,
    recommendation,
    reduction: null,
    savings: savings === null ? null : { monthly: savings, yearly: round(savings * 12), currency },
  };
  return {
    resourceId: analysis.resourceId,
    resourceArn: analysis.resourceArn,
    service: 'ec2',
    type: RecommendationType.EC2_SCHEDULE,
    source: RecommendationSource.CCG_HEURISTIC,
    title: `Stop ${analysis.name ?? analysis.resourceId} outside business hours (${window})`,
    description: `${reasons.join('. ')}. Estimated savings: ${savings === null ? 'unknown, the instance price is unavailable' : `${currency} ${savings}/month`}.`,
    severity: severityFor(savings),
    risk: Level.LOW,
    confidence: recommendation.confidence,
    currentMonthlyCost: monthly,
    recommendedMonthlyCost: monthly !== null && savings !== null ? round(monthly - savings) : null,
    estimatedMonthlySavings: savings,
    estimatedYearlySavings: savings === null ? null : round(savings * 12),
    currency,
    targetKey: scheduleKey(schedule),
    analysis: draftAnalysis,
  };
}
