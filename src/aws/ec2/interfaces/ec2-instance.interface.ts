export interface InstanceTypeSpec {
  instanceType: string;
  vcpu: number;
  memoryGiB: number;
  architectures: string[];
}

export interface Ec2InstanceDetails {
  instanceId: string;
  arn: string;
  name: string | null;
  instanceType: string;
  state: string;
  region: string;
  availabilityZone: string | null;
  platform: string | null;
  architecture: string | null;
  launchTime: string | null;
  tags: Record<string, string>;
  volumeIds: string[];
  vcpu: number | null;
  memoryGiB: number | null;
}
