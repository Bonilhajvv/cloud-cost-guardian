import { InstanceOption, UsageProfile } from '../../aws/ec2/interfaces/usage-profile.interface';

export interface ResourceUsageView {
  resourceId: string;
  name: string | null;
  instanceType: string | null;
  region: string | null;
  finding: string | null;
  usage: UsageProfile | null;
  options: InstanceOption[];
  notes: string[];
  analyzedAt: string | null;
}
