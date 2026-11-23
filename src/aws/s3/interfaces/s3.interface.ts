export interface S3LifecycleSummary {
  transitions: boolean;
  currentExpiration: boolean;
  noncurrentRules: boolean;
  abortsIncompleteUploads: boolean;
}

export interface S3Bucket {
  name: string;
  arn: string;
  region: string;
  versioned: boolean;
  lifecycle: S3LifecycleSummary;
  staleUploads: number | null;
}

export interface S3BucketMetadata {
  bucket: S3Bucket;
  storageGb: Record<string, number>;
  objects: number | null;
  prices: Record<string, number>;
}

export interface S3AnalyzerInput extends S3BucketMetadata {
  measuredMonthlyCost: number | null;
  currency: string;
  now?: Date;
}

export interface S3Discovery {
  buckets: S3Bucket[];
  unreadable: string[];
}
