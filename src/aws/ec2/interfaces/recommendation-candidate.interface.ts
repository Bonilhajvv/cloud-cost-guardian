import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { InstanceTypeSpec } from './ec2-instance.interface';

export interface RecommendationCandidate {
  type: RecommendationType;
  source: RecommendationSource;
  target: InstanceTypeSpec | null;
  targetType: string | null;
  monthlySavings: number | null;
  risk: Level;
  confidence: Level;
  reasons: string[];
}
