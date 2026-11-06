import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { EbsAnalysis } from '../../ebs/interfaces/ebs-analysis.interface';
import { Ec2Analysis } from '../../ec2/interfaces/ec2-analysis.interface';

export type ResourceAnalysis = Ec2Analysis | EbsAnalysis;

export interface RecommendationDraft {
  resourceId: string;
  resourceArn: string;
  service: string;
  type: RecommendationType;
  source: RecommendationSource;
  title: string;
  description: string;
  severity: Level;
  risk: Level;
  confidence: Level;
  currentMonthlyCost: number | null;
  recommendedMonthlyCost: number | null;
  estimatedMonthlySavings: number | null;
  estimatedYearlySavings: number | null;
  currency: string;
  targetKey: string | null;
  analysis: ResourceAnalysis;
}
