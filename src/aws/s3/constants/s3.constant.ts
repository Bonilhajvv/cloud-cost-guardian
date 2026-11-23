export const S3_LARGE_STANDARD_GB = 100;

export const S3_VERSIONED_MIN_GB = 10;

export const S3_STALE_UPLOAD_DAYS = 7;

export const S3_METRICS_DAYS = 4;

export const S3_STORAGE_TYPES: Record<string, string> = {
  standard: 'StandardStorage',
  standardIa: 'StandardIAStorage',
  oneZoneIa: 'OneZoneIAStorage',
  intelligentFrequent: 'IntelligentTieringFAStorage',
  intelligentInfrequent: 'IntelligentTieringIAStorage',
  intelligentArchiveInstant: 'IntelligentTieringAIAStorage',
  glacierInstant: 'GlacierInstantRetrievalStorage',
  glacier: 'GlacierStorage',
  deepArchive: 'DeepArchiveStorage',
};

export const S3_DEFAULT_REGION = 'us-east-1';

export const S3_CONCURRENCY = 10;
