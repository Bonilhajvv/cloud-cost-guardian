import { Ec2Analysis } from '../../ec2/interfaces/ec2-analysis.interface';
import { ResourceAnalysis } from '../interfaces/recommendation-draft.interface';

export function isEc2Analysis(analysis: ResourceAnalysis): analysis is Ec2Analysis {
  return analysis.kind !== 'EBS' && analysis.kind !== 'RDS' && analysis.kind !== 'COMMITMENT';
}
