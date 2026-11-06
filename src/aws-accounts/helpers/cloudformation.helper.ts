import { CFN_CONSOLE_REGION, CFN_STACK_NAME, READ_ONLY_ACTIONS, SUGGESTED_ROLE_NAME } from '../constants/aws-account.constant';

export function buildCloudFormationTemplate(): Record<string, unknown> {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Cloud Cost Guardian read-only access role (no write permissions)',
    Parameters: {
      ExternalId: { Type: 'String', MinLength: 16, Description: 'ExternalId provided by Cloud Cost Guardian' },
      PlatformAccountId: { Type: 'String', AllowedPattern: '^\\d{12}$', Description: 'Cloud Cost Guardian AWS account id' },
      RoleName: { Type: 'String', Default: SUGGESTED_ROLE_NAME },
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
                Statement: [{ Effect: 'Allow', Action: [...READ_ONLY_ACTIONS], Resource: '*' }],
              },
            },
          ],
        },
      },
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
