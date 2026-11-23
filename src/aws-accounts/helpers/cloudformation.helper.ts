import {
  CUR_QUERY,
  CUR_TABLE_CONFIGURATION,
  DATA_EXPORT_BUCKET_PREFIX,
  DATA_EXPORT_NAME,
  DATA_EXPORT_PREFIX,
  DATA_EXPORT_REGION,
} from '../../aws/data-exports/constants/data-exports.constant';
import { CFN_CONSOLE_REGION, CFN_STACK_NAME, READ_ONLY_ACTIONS, SUGGESTED_ROLE_NAME } from '../constants/aws-account.constant';

const EXPORT_BUCKET = `${DATA_EXPORT_BUCKET_PREFIX}-\${AWS::AccountId}`;

const EXPORT_BUCKET_ARN = `arn:\${AWS::Partition}:s3:::${EXPORT_BUCKET}`;

function costExportResources(): Record<string, unknown> {
  return {
    CostExportBucket: {
      Type: 'AWS::S3::Bucket',
      Condition: 'CreateCostExport',
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: {
        BucketName: { 'Fn::Sub': EXPORT_BUCKET },
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      },
    },
    CostExportBucketPolicy: {
      Type: 'AWS::S3::BucketPolicy',
      Condition: 'CreateCostExport',
      Properties: {
        Bucket: { Ref: 'CostExportBucket' },
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'EnableAWSDataExportsToWriteToS3',
              Effect: 'Allow',
              Principal: { Service: ['bcm-data-exports.amazonaws.com'] },
              Action: ['s3:PutObject'],
              Resource: { 'Fn::Sub': `${EXPORT_BUCKET_ARN}/*` },
              Condition: {
                ArnLike: { 'aws:SourceArn': { 'Fn::Sub': `arn:\${AWS::Partition}:bcm-data-exports:${DATA_EXPORT_REGION}:\${AWS::AccountId}:export/*` } },
                StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } },
              },
            },
          ],
        },
      },
    },
    CostExport: {
      Type: 'AWS::BCMDataExports::Export',
      Condition: 'CreateCostExport',
      DependsOn: 'CostExportBucketPolicy',
      Properties: {
        Export: {
          Name: DATA_EXPORT_NAME,
          Description: 'Daily cost per resource, used by Cloud Cost Guardian to measure realized savings',
          DataQuery: { QueryStatement: CUR_QUERY, TableConfigurations: { COST_AND_USAGE_REPORT: { ...CUR_TABLE_CONFIGURATION } } },
          DestinationConfigurations: {
            S3Destination: {
              S3Bucket: { Ref: 'CostExportBucket' },
              S3Prefix: DATA_EXPORT_PREFIX,
              S3Region: DATA_EXPORT_REGION,
              S3OutputConfigurations: { OutputType: 'CUSTOM', Format: 'TEXT_OR_CSV', Compression: 'GZIP', Overwrite: 'OVERWRITE_REPORT' },
            },
          },
          RefreshCadence: { Frequency: 'SYNCHRONOUS' },
        },
      },
    },
  };
}

export function buildCloudFormationTemplate(): Record<string, unknown> {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Cloud Cost Guardian read-only access role (no write permissions)',
    Parameters: {
      ExternalId: { Type: 'String', MinLength: 16, Description: 'ExternalId provided by Cloud Cost Guardian' },
      PlatformAccountId: { Type: 'String', AllowedPattern: '^\\d{12}$', Description: 'Cloud Cost Guardian AWS account id' },
      RoleName: { Type: 'String', Default: SUGGESTED_ROLE_NAME },
      EnableCostExport: {
        Type: 'String',
        Default: 'true',
        AllowedValues: ['true', 'false'],
        Description: `Create a private S3 bucket and a CUR 2.0 export so realized savings are measured (only in ${DATA_EXPORT_REGION})`,
      },
    },
    Conditions: {
      CreateCostExport: { 'Fn::And': [{ 'Fn::Equals': [{ Ref: 'EnableCostExport' }, 'true'] }, { 'Fn::Equals': [{ Ref: 'AWS::Region' }, DATA_EXPORT_REGION] }] },
    },
    Resources: {
      CloudCostGuardianRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: { Ref: 'RoleName' },
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: { 'Fn::Sub': 'arn:${AWS::Partition}:iam::${PlatformAccountId}:root' } },
                Action: 'sts:AssumeRole',
                Condition: { StringEquals: { 'sts:ExternalId': { Ref: 'ExternalId' } } },
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'ccg-readonly',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  { Effect: 'Allow', Action: [...READ_ONLY_ACTIONS], Resource: '*' },
                  { Effect: 'Allow', Action: ['s3:ListBucket', 's3:GetObject'], Resource: [{ 'Fn::Sub': EXPORT_BUCKET_ARN }, { 'Fn::Sub': `${EXPORT_BUCKET_ARN}/*` }] },
                ],
              },
            },
          ],
        },
      },
      ...costExportResources(),
    },
    Outputs: {
      RoleArn: { Value: { 'Fn::GetAtt': ['CloudCostGuardianRole', 'Arn'] } },
    },
  };
}

export function buildQuickCreateUrl(templateUrl: string, externalId: string, platformAccountId: string): string {
  const params = new URLSearchParams({
    templateURL: templateUrl,
    stackName: CFN_STACK_NAME,
    param_ExternalId: externalId,
    param_PlatformAccountId: platformAccountId,
    param_RoleName: SUGGESTED_ROLE_NAME,
  });
  return `https://console.aws.amazon.com/cloudformation/home?region=${CFN_CONSOLE_REGION}#/stacks/quickcreate?${params.toString()}`;
}

export function predictedRoleArn(awsAccountId: string): string {
  return `arn:aws:iam::${awsAccountId}:role/${SUGGESTED_ROLE_NAME}`;
}
