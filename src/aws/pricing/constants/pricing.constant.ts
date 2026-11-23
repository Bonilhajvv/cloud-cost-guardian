export const PRICING_API_REGION = 'us-east-1';

export const HOURS_PER_MONTH = 730;

export const PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const PRICING_OS_BY_PLATFORM: Record<string, string> = {
  'Linux/UNIX': 'Linux',
  Windows: 'Windows',
  'Red Hat Enterprise Linux': 'RHEL',
  'SUSE Linux': 'SUSE',
};

export const DEFAULT_PRICING_OS = 'Linux';

export const RDS_PRICING_ENGINES: Record<string, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
};

export const AURORA_PRICING_ENGINES: Record<string, string> = {
  'aurora-postgresql': 'Aurora PostgreSQL',
  'aurora-mysql': 'Aurora MySQL',
};

export const RDS_STORAGE_USAGE: Record<string, { volumeType: string; usage: string }> = {
  gp2: { volumeType: 'General Purpose', usage: 'GP2-Storage' },
  gp3: { volumeType: 'General Purpose-GP3', usage: 'GP3-Storage' },
  io1: { volumeType: 'Provisioned IOPS', usage: 'PIOPS-Storage' },
  io2: { volumeType: 'Provisioned IOPS-IO2', usage: 'PIOPS-Storage-IO2' },
  standard: { volumeType: 'Magnetic', usage: 'StorageUsage' },
};

export const RDS_IOPS_USAGE: Record<string, string> = { io1: 'PIOPS', io2: 'IO2-PIOPS' };

export const S3_SERVICE = 'AmazonS3';

export const LAMBDA_SERVICE = 'AWSLambda';

export const EC2_SERVICE = 'AmazonEC2';

export const RDS_SERVICE = 'AmazonRDS';

export const ELB_SERVICE = 'AWSELB';

export const VPC_SERVICE = 'AmazonVPC';
