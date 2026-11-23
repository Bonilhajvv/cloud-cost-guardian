import { BinaryLike, createHash, createHmac, Hash, Hmac } from 'crypto';
import { SignatureV4 } from '@smithy/signature-v4';
import { TemporaryCredentials } from '../../core/interfaces/temporary-credentials.interface';
import { EKS_CLUSTER_HEADER, EKS_TOKEN_PREFIX, EKS_TOKEN_TTL_SECONDS } from '../constants/eks.constant';

class Sha256 {
  private readonly hash: Hash | Hmac;

  constructor(secret?: unknown) {
    this.hash = secret ? createHmac('sha256', secret as BinaryLike) : createHash('sha256');
  }

  update(data: Uint8Array): void {
    this.hash.update(data);
  }

  digest(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(this.hash.digest()));
  }

  reset(): void {}
}

export async function eksToken(credentials: TemporaryCredentials, clusterName: string, region: string, now = new Date()): Promise<string> {
  const hostname = `sts.${region}.${region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com'}`;
  const signer = new SignatureV4({ service: 'sts', region, sha256: Sha256 as never, credentials });
  const signed = await signer.presign(
    {
      method: 'GET',
      protocol: 'https:',
      hostname,
      path: '/',
      query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
      headers: { host: hostname, [EKS_CLUSTER_HEADER]: clusterName },
    },
    { expiresIn: EKS_TOKEN_TTL_SECONDS, signingDate: now },
  );
  const query = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return EKS_TOKEN_PREFIX + Buffer.from(`https://${hostname}/?${query}`).toString('base64url');
}
