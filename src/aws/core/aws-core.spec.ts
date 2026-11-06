import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { AwsCredentialsService } from './aws-credentials.service';
import { toAwsIntegrationError } from './errors/aws-integration.error';
import { parseArn } from './helpers/arn.helper';
import { forEachRegion } from './helpers/region-runner.helper';
import { AwsAccountRef } from './interfaces/aws-account-ref.interface';
import { TemporaryCredentials } from './interfaces/temporary-credentials.interface';

const account: AwsAccountRef = {
  id: '11111111-2222-3333-4444-555555555555',
  organizationId: 'org',
  awsAccountId: '111122223333',
  roleArn: 'arn:aws:iam::111122223333:role/CloudCostGuardianReadOnly',
  externalId: 'ext',
  defaultRegion: 'sa-east-1',
};

const config = {
  get: (key: keyof EnvironmentVariables) =>
    ({ AWS_REGION: 'us-east-1', AWS_MAX_ATTEMPTS: 3, AWS_ASSUME_ROLE_DURATION_SECONDS: 3600 })[key as string],
} as unknown as ConfigService<EnvironmentVariables, true>;

function creds(minutesValid: number): TemporaryCredentials {
  return { accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST', expiration: new Date(Date.now() + minutesValid * 60_000) };
}

describe('AwsCredentialsService', () => {
  it('reuses cached credentials and deduplicates concurrent AssumeRole calls', async () => {
    const service = new AwsCredentialsService(config);
    const assume = jest.spyOn(service, 'assumeRole').mockResolvedValue(creds(60));

    await Promise.all([service.getCredentials(account), service.getCredentials(account)]);
    await service.getCredentials(account);

    expect(assume).toHaveBeenCalledTimes(1);
  });

  it('refreshes credentials close to expiration', async () => {
    const service = new AwsCredentialsService(config);
    const assume = jest.spyOn(service, 'assumeRole').mockResolvedValueOnce(creds(2)).mockResolvedValueOnce(creds(60));

    await service.getCredentials(account);
    await service.getCredentials(account);

    expect(assume).toHaveBeenCalledTimes(2);
  });

  it('refuses to assume a role when roleArn is missing', async () => {
    const service = new AwsCredentialsService(config);
    await expect(service.assumeRole({ ...account, roleArn: null })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });
});

describe('forEachRegion', () => {
  it('isolates per-region failures', async () => {
    const accessDenied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const result = await forEachRegion(['us-east-1', 'sa-east-1', 'eu-west-1'], async (region) => {
      if (region === 'sa-east-1') throw accessDenied;
      return region.length;
    });

    expect(result.results.map((r) => r.region)).toEqual(['us-east-1', 'eu-west-1']);
    expect(result.failures).toEqual([{ region: 'sa-east-1', code: 'ACCESS_DENIED', message: 'denied' }]);
  });
});

describe('toAwsIntegrationError', () => {
  it.each([
    ['ThrottlingException', 'THROTTLED'],
    ['OptInRequiredException', 'NOT_ENROLLED'],
    ['UnauthorizedOperation', 'ACCESS_DENIED'],
    ['SomethingElse', 'UNKNOWN'],
  ])('%s -> %s', (name, code) => {
    expect(toAwsIntegrationError(Object.assign(new Error('x'), { name })).code).toBe(code);
  });
});

describe('parseArn', () => {
  it('parses EC2 instance and S3 bucket ARNs', () => {
    expect(parseArn('arn:aws:ec2:sa-east-1:111122223333:instance/i-0abc')).toMatchObject({ service: 'ec2', region: 'sa-east-1', resourceId: 'i-0abc' });
    expect(parseArn('arn:aws:s3:::my-bucket')).toMatchObject({ service: 's3', region: '', resourceId: 'my-bucket' });
    expect(parseArn('not-an-arn')).toBeNull();
  });
});
