import { EbsVolume } from '../../aws/ebs/interfaces/ebs-volume.interface';
import { AwsResourceData } from '../../aws/resources/interfaces/aws-resource-data.interface';
import { EBS_VOLUME_RESOURCE_TYPE } from '../constants/resource-types.constant';

export function ebsToResourceData(volume: EbsVolume): AwsResourceData {
  return {
    arn: volume.arn,
    resourceId: volume.volumeId,
    service: 'ec2',
    resourceType: EBS_VOLUME_RESOURCE_TYPE,
    region: volume.region,
    name: volume.name ?? undefined,
    tags: volume.tags,
  };
}
