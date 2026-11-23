import { Agent, request } from 'https';
import { DescribeClusterCommand, EKSClient } from '@aws-sdk/client-eks';
import { Injectable } from '@nestjs/common';
import { AwsClientFactory } from '../core/aws-client.factory';
import { AwsCredentialsService } from '../core/aws-credentials.service';
import { AwsIntegrationError, toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { EKS_ENDPOINT_PATTERN, EKS_MAX_ITEMS, EKS_MAX_RESPONSE_BYTES, EKS_PAGE_SIZE, EKS_REQUEST_TIMEOUT_MS } from './constants/eks.constant';
import { eksToken } from './helpers/eks-token.helper';
import { EksClusterAccess, KubeListPage } from './interfaces/eks.interface';

@Injectable()
export class EksService {
  constructor(
    private readonly clients: AwsClientFactory,
    private readonly credentials: AwsCredentialsService,
  ) {}

  async describe(account: AwsAccountRef, region: string, clusterName: string): Promise<EksClusterAccess> {
    const client = await this.clients.createClient(EKSClient, account, region);
    let cluster;
    try {
      ({ cluster } = await client.send(new DescribeClusterCommand({ name: clusterName })));
    } catch (error) {
      throw toAwsIntegrationError(error, `DescribeCluster ${clusterName}`);
    }
    const ca = cluster?.certificateAuthority?.data;
    if (!cluster?.endpoint || !ca) throw new AwsIntegrationError('DATA_UNAVAILABLE', `EKS cluster ${clusterName} is not active`);
    if (cluster.resourcesVpcConfig?.endpointPublicAccess === false) {
      throw new AwsIntegrationError('INVALID_CONFIGURATION', `EKS cluster ${clusterName} has a private endpoint: install the agent instead`);
    }
    if (cluster.accessConfig?.authenticationMode === 'CONFIG_MAP') {
      throw new AwsIntegrationError('INVALID_CONFIGURATION', `EKS cluster ${clusterName} does not accept access entries: set the authentication mode to API_AND_CONFIG_MAP`);
    }
    if (!EKS_ENDPOINT_PATTERN.test(cluster.endpoint)) throw new AwsIntegrationError('INVALID_CONFIGURATION', 'Unexpected EKS endpoint');
    return { account, clusterName, region, endpoint: cluster.endpoint, ca: Buffer.from(ca, 'base64').toString('utf8') };
  }

  async get<T>(access: EksClusterAccess, path: string): Promise<T | null> {
    const credentials = await this.credentials.getCredentials(access.account);
    const token = await eksToken(credentials, access.clusterName, access.region);
    return this.fetchJson<T>(access, path, token);
  }

  async list<T>(access: EksClusterAccess, path: string): Promise<T[] | null> {
    const items: T[] = [];
    let next: string | undefined;
    do {
      const query = `limit=${EKS_PAGE_SIZE}${next ? `&continue=${encodeURIComponent(next)}` : ''}`;
      const page = await this.get<KubeListPage<T>>(access, `${path}?${query}`);
      if (page === null) return null;
      items.push(...(page.items ?? []));
      if (items.length > EKS_MAX_ITEMS) throw new AwsIntegrationError('DATA_UNAVAILABLE', `Too many objects in ${path}`);
      next = page.metadata?.continue || undefined;
    } while (next);
    return items;
  }

  private fetchJson<T>(access: EksClusterAccess, path: string, token: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const agent = new Agent({ ca: access.ca, keepAlive: false });
      const req = request(
        `${access.endpoint}${path}`,
        { agent, method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(EKS_REQUEST_TIMEOUT_MS) },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > EKS_MAX_RESPONSE_BYTES) req.destroy(new Error('Kubernetes API response too large'));
            else chunks.push(chunk);
          });
          res.on('error', (error) => reject(toAwsIntegrationError(error, 'Kubernetes API')));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (status === 404 || status === 503) return resolve(null);
            if (status === 401 || status === 403) {
              return reject(new AwsIntegrationError('ACCESS_DENIED', `Kubernetes API answered ${status} on ${path.split('?')[0]}: check the access entry and the ClusterRoleBinding`));
            }
            if (status >= 300) return reject(new AwsIntegrationError('UNKNOWN', `Kubernetes API answered ${status} on ${path.split('?')[0]}`));
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
            } catch {
              reject(new AwsIntegrationError('UNKNOWN', 'Kubernetes API returned invalid JSON'));
            }
          });
        },
      );
      req.on('error', (error) => reject(toAwsIntegrationError(error, 'Kubernetes API')));
      req.end();
    });
  }
}
