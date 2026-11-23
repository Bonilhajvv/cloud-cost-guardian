import { Injectable } from '@nestjs/common';
import { Level, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { buildServiceAnalysis } from '../core/helpers/service-analysis.helper';
import { ServiceAnalysisResult, ServiceOpportunity } from '../core/interfaces/service-analysis.interface';
import { S3_LARGE_STANDARD_GB, S3_STALE_UPLOAD_DAYS, S3_VERSIONED_MIN_GB } from './constants/s3.constant';
import { S3AnalyzerInput } from './interfaces/s3.interface';

@Injectable()
export class S3AnalyzerService {
  analyze(input: S3AnalyzerInput): ServiceAnalysisResult {
    const { bucket, storageGb, prices, currency } = input;
    const standardGb = storageGb.standard ?? null;
    const totalGb = Object.values(storageGb).reduce((a, b) => a + b, 0);
    const standardCost = standardGb !== null && prices.standard !== undefined ? round(standardGb * prices.standard) : null;
    const monthlyCost = input.measuredMonthlyCost === null ? standardCost : round(input.measuredMonthlyCost);
    const notes = [
      input.measuredMonthlyCost === null
        ? 'Monthly cost covers only S3 Standard storage at the first price tier: requests, transfer and other classes are not included'
        : 'Monthly cost measured in the cost export (last 30 days, requests and transfer included)',
    ];
    if (Object.keys(storageGb).length === 0) notes.push('No storage metrics: the bucket is empty or the metrics are unavailable');
    const base = {
      kind: 'S3' as const,
      resourceId: bucket.name,
      resourceArn: bucket.arn,
      name: bucket.name,
      region: bucket.region,
      current: {
        monthlyCost,
        details: {
          totalGb: round(totalGb),
          standardGb: standardGb === null ? null : round(standardGb),
          objects: input.objects,
          versioned: bucket.versioned,
          lifecycleTransitions: bucket.lifecycle.transitions,
          abortsIncompleteUploads: bucket.lifecycle.abortsIncompleteUploads,
          staleUploads: bucket.staleUploads,
        },
      },
      notes,
    };
    const opportunity = this.lifecycle(input, standardGb, totalGb, standardCost);
    return buildServiceAnalysis(base, 's3', opportunity ? [opportunity] : [], currency, input.now ?? new Date());
  }

  private lifecycle(input: S3AnalyzerInput, standardGb: number | null, totalGb: number, standardCost: number | null): ServiceOpportunity | null {
    const { bucket, prices, currency } = input;
    const { lifecycle } = bucket;
    const reasons: string[] = [];
    const targets: string[] = [];
    if (standardGb !== null && standardGb >= S3_LARGE_STANDARD_GB && !lifecycle.transitions && !lifecycle.currentExpiration) {
      targets.push('TIERING');
      const ceiling = prices.standard !== undefined && prices.infrequentAccess !== undefined ? round(standardGb * (prices.standard - prices.infrequentAccess)) : null;
      reasons.push(
        `${round(standardGb)} GB in S3 Standard${standardCost === null ? '' : ` (${currency} ${standardCost}/month)`} with no transition or expiration rule`,
        'Use Intelligent-Tiering when the access pattern is unknown, or transition old objects to Standard-IA: objects below 128 KB do not benefit, and IA charges retrieval and a 30-day minimum',
        ...(ceiling === null ? [] : [`How much data is rarely read is unknown: the saving is at most ${currency} ${ceiling}/month moving everything to infrequent access`]),
      );
    }
    if (bucket.versioned && !lifecycle.noncurrentRules && totalGb >= S3_VERSIONED_MIN_GB) {
      targets.push('NONCURRENT');
      reasons.push('Versioning is on and no rule expires noncurrent versions: deleted and overwritten objects are billed forever');
    }
    if ((bucket.staleUploads ?? 0) > 0 && !lifecycle.abortsIncompleteUploads) {
      targets.push('MULTIPART');
      reasons.push(`At least ${bucket.staleUploads} multipart uploads have been incomplete for more than ${S3_STALE_UPLOAD_DAYS} days: their parts are billed but invisible; add an AbortIncompleteMultipartUpload rule`);
    }
    if (targets.length === 0) return null;
    reasons.push('Confirm retention and compliance requirements before expiring data: expired objects cannot be recovered');
    const onlyMultipart = targets.length === 1 && targets[0] === 'MULTIPART';
    return {
      type: RecommendationType.S3_LIFECYCLE,
      targetKey: targets.join('+'),
      title: `Add lifecycle rules to S3 bucket ${bucket.name}`,
      reasons,
      monthlySavings: null,
      risk: onlyMultipart ? Level.LOW : Level.MEDIUM,
      confidence: onlyMultipart ? Level.HIGH : Level.MEDIUM,
    };
  }
}
