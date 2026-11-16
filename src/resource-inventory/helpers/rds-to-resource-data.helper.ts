import { RdsInstance } from '../../aws/rds/interfaces/rds-instance.interface';
import { AwsResourceData } from '../../aws/resources/interfaces/aws-resource-data.interface';
import { RDS_DB_INSTANCE_RESOURCE_TYPE } from '../constants/resource-types.constant';

export function rdsToResourceData(db: RdsInstance): AwsResourceData {
  return {
    arn: db.arn,
    resourceId: db.dbInstanceId,
    service: 'rds',
    resourceType: RDS_DB_INSTANCE_RESOURCE_TYPE,
    region: db.region,
    name: db.dbInstanceId,
    tags: db.tags,
  };
}
