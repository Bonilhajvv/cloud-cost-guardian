import { READ_ONLY_ACTIONS } from '../constants/aws-account.constant';
import { buildCloudFormationTemplate } from './cloudformation.helper';
import { buildPermissionsPolicy } from './iam-policy.helper';

type Template = { Resources: Record<string, { Condition?: string; Properties: Record<string, never> }> };

describe('CloudFormation template', () => {
  const template = buildCloudFormationTemplate() as unknown as Template;
  const text = JSON.stringify(template);

  it('keeps the role read-only', () => {
    expect(READ_ONLY_ACTIONS.filter((a) => !/:(Describe|Get|List|Search)/.test(a))).toEqual([]);
    expect(READ_ONLY_ACTIONS).not.toContain('s3:GetObject');
  });

  it('creates a private export bucket that only Data Exports of the same account can write to', () => {
    for (const name of ['CostExportBucket', 'CostExportBucketPolicy', 'CostExport']) expect(template.Resources[name].Condition).toBe('CreateCostExport');
    expect(text).toContain('"aws:SourceAccount":{"Ref":"AWS::AccountId"}');
    expect(text).toContain('arn:${AWS::Partition}:s3:::ccg-cur-${AWS::AccountId}/*');
    expect(text).toContain('"BlockPublicPolicy":true');
    expect(text).not.toContain('\\\\${');
  });

  it('scopes object reads to the export bucket in the manual policy', () => {
    const policy = buildPermissionsPolicy('111122223333') as { Statement: { Action: string[]; Resource: string | string[] }[] };
    expect(policy.Statement[1]).toMatchObject({ Action: ['s3:ListBucket', 's3:GetObject'], Resource: ['arn:aws:s3:::ccg-cur-111122223333', 'arn:aws:s3:::ccg-cur-111122223333/*'] });
  });
});
