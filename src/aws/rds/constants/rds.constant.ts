export const STANDARD_SUPPORT = 'open-source-rds-standard-support';

export const EXTENDED_SUPPORT = 'open-source-rds-extended-support';

export const IDLE_MIN_DATAPOINTS = 7 * 24;

export const SUPPORT_ENDING_SOON_DAYS = 180;

export const EXTENDED_SUPPORT_TIER1_YEARS = 2;

export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const RDS_IO_STORAGE_TYPES: readonly string[] = ['io1', 'io2'];

export const RDS_MIN_STORAGE_GB = 20;

export const RDS_GP3_LARGE_GB = 400;

export const RDS_GP3_BASELINE = { small: { iops: 3000, mbps: 125 }, large: { iops: 12000, mbps: 500 } } as const;

export const RDS_STORAGE_HEADROOM = 1.3;

export const RDS_PERFORMANCE_HEADROOM = 1.2;

export const RDS_STORAGE_SHRINK_MAX_RATIO = 0.6;

export const RDS_STORAGE_MIN_SAVINGS = 5;

export const RDS_BACKUP_MIN_MONTHLY_COST = 5;

export const RDS_BACKUP_REFRESH_MS = 20 * 60 * 60 * 1000;

export const RDS_BACKUP_WINDOW_DAYS = 30;

export const RDS_BACKUP_USAGE_TYPE = /(RDS:ChargedBackupUsage|Aurora:BackupUsage)$/;

export const RDS_LONG_RETENTION_DAYS = 7;

export const AURORA_SERVERLESS_CLASS = 'db.serverless';

export const AURORA_FLOOR_TOLERANCE = 1.05;

export const AURORA_FLOOR_MIN_RATIO = 0.9;

export const AURORA_LOWEST_CAPACITY = 0.5;

export const AURORA_MODE_MIN_SAVINGS = 10;

export const AURORA_MODE_MIN_RATIO = 0.1;

export const CONNECTIONS_BLOCK_RATIO = 0.8;

export const CONNECTIONS_HIGH_RISK_RATIO = 0.6;

export const MAX_CONNECTIONS_PARAMETER = 'max_connections';

export const DEFAULT_PARAMETER_GROUP_PREFIX = 'default.';

export const SMALL_CLASS_MEMORY_GB = 2;

export const AUTOMATED_SNAPSHOT_ARN = /:snapshot:(rds|awsbackup):/;
