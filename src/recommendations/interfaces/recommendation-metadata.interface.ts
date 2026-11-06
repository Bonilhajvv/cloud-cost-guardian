import { ResourceAnalysis } from '../../aws/core/interfaces/recommendation-draft.interface';

export interface RecommendationMetadata {
  analysis?: ResourceAnalysis;
  targetKey?: string | null;
  statusNote?: string;
}
