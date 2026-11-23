import { RecommendationType } from '../../common/enums';
import { EMPTY_LIFECYCLE, summarizeLifecycle } from './helpers/lifecycle.helper';
import { S3AnalyzerInput } from './interfaces/s3.interface';
import { S3AnalyzerService } from './s3-analyzer.service';

const input = (bucket: object = {}, over: Partial<S3AnalyzerInput> = {}): S3AnalyzerInput => ({
  bucket: { name: 'logs', arn: 'arn:aws:s3:::logs', region: 'us-east-1', versioned: false, lifecycle: EMPTY_LIFECYCLE, staleUploads: 0, ...bucket },
  storageGb: { standard: 1000 },
  objects: 10,
  prices: { standard: 0.023, infrequentAccess: 0.0125 },
  measuredMonthlyCost: null,
  currency: 'USD',
  ...over,
});

describe('S3AnalyzerService', () => {
  const analyzer = new S3AnalyzerService();

  it('recommends tiering with a ceiling instead of an invented saving', () => {
    const { analysis, drafts } = analyzer.analyze(input());
    expect(analysis.current.monthlyCost).toBe(23);
    expect(drafts[0]).toMatchObject({ type: RecommendationType.S3_LIFECYCLE, targetKey: 'TIERING', estimatedMonthlySavings: null });
    expect(drafts[0].description).toContain('at most USD 10.5/month');
  });

  it('prefers the cost measured in the export', () => {
    expect(analyzer.analyze(input({}, { measuredMonthlyCost: 41.237 })).analysis.current.monthlyCost).toBe(41.24);
  });

  it('flags noncurrent versions and stale uploads, and respects existing rules', () => {
    const small = { storageGb: { standard: 20 } };
    expect(analyzer.analyze(input({ versioned: true, staleUploads: 3 }, small)).drafts[0].targetKey).toBe('NONCURRENT+MULTIPART');
    const lifecycle = { transitions: true, currentExpiration: false, noncurrentRules: true, abortsIncompleteUploads: true };
    expect(analyzer.analyze(input({ versioned: true, staleUploads: 3, lifecycle })).drafts).toEqual([]);
    expect(analyzer.analyze(input({ staleUploads: null }, small)).drafts).toEqual([]);
  });

  it('ignores disabled lifecycle rules', () => {
    expect(summarizeLifecycle([{ Status: 'Disabled', Transitions: [{ Days: 30 }] }])).toEqual(EMPTY_LIFECYCLE);
    expect(summarizeLifecycle([{ Status: 'Enabled', Expiration: { ExpiredObjectDeleteMarker: true } }]).currentExpiration).toBe(false);
  });
});
