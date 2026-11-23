import { EKSClient } from '@aws-sdk/client-eks';
import { AwsClientFactory } from '../core/aws-client.factory';
import { AwsCredentialsService } from '../core/aws-credentials.service';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { EksService } from './eks.service';
import { eksToken } from './helpers/eks-token.helper';

const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'session/token+=', expiration: new Date() };

describe('eksToken', () => {
  it('is a presigned GetCallerIdentity URL bound to the cluster', async () => {
    const at = new Date('2026-11-23T12:00:00Z');
    const token = await eksToken(credentials, 'prd', 'us-east-1', at);
    const url = new URL(Buffer.from(token.replace('k8s-aws-v1.', ''), 'base64url').toString());
    expect(token).toMatch(/^k8s-aws-v1\.[A-Za-z0-9_-]+$/);
    expect(url.host).toBe('sts.us-east-1.amazonaws.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      Action: 'GetCallerIdentity',
      'X-Amz-SignedHeaders': 'host;x-k8s-aws-id',
      'X-Amz-Expires': '60',
      'X-Amz-Date': '20261123T120000Z',
      'X-Amz-Security-Token': 'session/token+=',
    });
    expect(await eksToken(credentials, 'hml', 'us-east-1', at)).not.toBe(token);
  });
});

describe('EksService.describe', () => {
  const cluster = { endpoint: 'https://ABC.gr7.us-east-1.eks.amazonaws.com', certificateAuthority: { data: Buffer.from('CA').toString('base64') }, resourcesVpcConfig: { endpointPublicAccess: true }, accessConfig: { authenticationMode: 'API' } };
  const describeWith = (over: object) => {
    const factory = { createClient: async () => ({ send: async () => ({ cluster: { ...cluster, ...over } }) }) as unknown as EKSClient };
    return new EksService(factory as unknown as AwsClientFactory, {} as AwsCredentialsService).describe({} as AwsAccountRef, 'us-east-1', 'prd');
  };

  it('returns the endpoint and the decoded CA', async () => {
    expect(await describeWith({})).toMatchObject({ endpoint: cluster.endpoint, ca: 'CA' });
  });

  it.each([
    ['private endpoint', { resourcesVpcConfig: { endpointPublicAccess: false } }, 'private endpoint'],
    ['ConfigMap authentication', { accessConfig: { authenticationMode: 'CONFIG_MAP' } }, 'access entries'],
    ['endpoint outside AWS', { endpoint: 'https://169.254.169.254' }, 'Unexpected EKS endpoint'],
    ['lookalike endpoint', { endpoint: 'https://eks.amazonaws.com.evil.example' }, 'Unexpected EKS endpoint'],
  ])('rejects %s', async (_name, over, message) => {
    await expect(describeWith(over)).rejects.toThrow(message);
  });
});
