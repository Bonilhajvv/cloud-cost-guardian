import { Ec2Analysis } from '../../ec2/interfaces/ec2-analysis.interface';
import { EbsAnalysis } from '../../ebs/interfaces/ebs-analysis.interface';
import { RdsAnalysis } from '../../rds/interfaces/rds-analysis.interface';
import { ResourceAnalysis } from '../interfaces/recommendation-draft.interface';

export function isEc2Analysis(analysis: ResourceAnalysis): analysis is Ec2Analysis {
  return analysis.kind === undefined || analysis.kind === 'EC2';
}

export function isSizedAnalysis(analysis: ResourceAnalysis): analysis is Ec2Analysis | EbsAnalysis | RdsAnalysis {
  return isEc2Analysis(analysis) || analysis.kind === 'EBS' || analysis.kind === 'RDS';
}
