import { Ec2InstanceDetails } from '../../aws/ec2/interfaces/ec2-instance.interface';
import { AwsResourceData } from '../../aws/resources/interfaces/aws-resource-data.interface';
import { EC2_INSTANCE_RESOURCE_TYPE } from '../constants/resource-types.constant';

export function ec2ToResourceData(instance: Ec2InstanceDetails): AwsResourceData {
  return {
    arn: instance.arn,
    resourceId: instance.instanceId,
    service: 'ec2',
    resourceType: EC2_INSTANCE_RESOURCE_TYPE,
    region: instance.region,
    name: instance.name ?? undefined,
    tags: instance.tags,
  };
}
