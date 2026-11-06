export interface EbsVolume {
  volumeId: string;
  arn: string;
  name: string | null;
  volumeType: string;
  sizeGiB: number;
  iops: number | null;
  throughputMBps: number | null;
  state: string;
  attachedInstanceIds: string[];
  createTime: string | null;
  region: string;
  availabilityZone: string | null;
  encrypted: boolean;
  tags: Record<string, string>;
}
