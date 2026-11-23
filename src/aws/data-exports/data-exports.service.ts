import { Readable, pipeline } from 'stream';
import { createGunzip } from 'zlib';
import { GetObjectCommand, S3Client, paginateListObjectsV2 } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { AwsClientFactory } from '../core/aws-client.factory';
import { AwsIntegrationError, toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { BILLING_PERIOD_PATTERN, DATA_EXPORT_NAME, DATA_EXPORT_PREFIX, DATA_EXPORT_REGION, dataExportBucket } from './constants/data-exports.constant';
import { curLineReader } from './helpers/cur-line.helper';
import { parseCsv } from './helpers/parse-csv.helper';
import { CurLine, ExportManifest } from './interfaces/data-export.interface';

const ROOT = `${DATA_EXPORT_PREFIX}/${DATA_EXPORT_NAME}`;

@Injectable()
export class DataExportsService {
  constructor(private readonly clients: AwsClientFactory) {}

  async listManifests(account: AwsAccountRef): Promise<ExportManifest[]> {
    const client = await this.clients.createClient(S3Client, account, DATA_EXPORT_REGION);
    const out: ExportManifest[] = [];
    try {
      const pages = paginateListObjectsV2({ client }, { Bucket: dataExportBucket(account.awsAccountId), Prefix: `${ROOT}/metadata/`, ExpectedBucketOwner: account.awsAccountId });
      for await (const page of pages) {
        for (const object of page.Contents ?? []) {
          const period = object.Key?.match(BILLING_PERIOD_PATTERN)?.[1];
          if (object.Key && period && object.Key.endsWith('Manifest.json')) {
            out.push({ billingPeriod: period, key: object.Key, version: `${object.ETag ?? ''}|${object.LastModified?.toISOString() ?? ''}` });
          }
        }
      }
    } catch (error) {
      throw toAwsIntegrationError(error, 'ListObjectsV2 cost export');
    }
    return out.sort((a, b) => a.billingPeriod.localeCompare(b.billingPeriod));
  }

  async dataFiles(account: AwsAccountRef, manifest: ExportManifest): Promise<string[]> {
    const bucket = dataExportBucket(account.awsAccountId);
    const body = await this.open(account, manifest.key);
    let text = '';
    body.setEncoding('utf8');
    for await (const chunk of body) text += String(chunk);
    const files = (JSON.parse(text) as { dataFiles?: unknown }).dataFiles;
    if (!Array.isArray(files)) throw new AwsIntegrationError('INVALID_CONFIGURATION', 'Cost export manifest has no dataFiles');
    const prefix = `s3://${bucket}/${ROOT}/data/BILLING_PERIOD=${manifest.billingPeriod}/`;
    const invalid = files.find((f) => typeof f !== 'string' || !f.startsWith(prefix) || !f.endsWith('.csv.gz'));
    if (invalid !== undefined) throw new AwsIntegrationError('INVALID_CONFIGURATION', 'Cost export must deliver gzip CSV files in its own prefix');
    return (files as string[]).map((f) => f.slice(`s3://${bucket}/`.length));
  }

  async *readLines(account: AwsAccountRef, key: string): AsyncGenerator<CurLine> {
    const body = await this.open(account, key);
    const gunzip = createGunzip();
    gunzip.setEncoding('utf8');
    pipeline(body, gunzip, () => undefined);
    let toLine: ((row: readonly string[]) => CurLine) | null = null;
    for await (const row of parseCsv(gunzip as AsyncIterable<string>)) {
      if (toLine) {
        yield toLine(row);
        continue;
      }
      toLine = curLineReader(row);
      if (!toLine) throw new AwsIntegrationError('INVALID_CONFIGURATION', 'Cost export is missing required columns: update the CloudFormation stack');
    }
  }

  private async open(account: AwsAccountRef, key: string): Promise<Readable> {
    const client = await this.clients.createClient(S3Client, account, DATA_EXPORT_REGION);
    try {
      const { Body } = await client.send(new GetObjectCommand({ Bucket: dataExportBucket(account.awsAccountId), Key: key, ExpectedBucketOwner: account.awsAccountId }));
      return Body as Readable;
    } catch (error) {
      throw toAwsIntegrationError(error, 'GetObject cost export');
    }
  }
}
