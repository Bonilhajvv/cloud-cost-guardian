export const GP3_BASELINE_IOPS = 3000;

export const GP3_BASELINE_THROUGHPUT_MBPS = 125;

export const RECENT_VOLUME_DAYS = 7;

export const MIN_EBS_DATAPOINTS = 7 * 24;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const EXPAND_TRIGGER_USED_PERCENT = 85;

export const EXPAND_TARGET_USED_PERCENT = 70;

export const PERFORMANCE_HEADROOM = 1.5;

export const GP3_LIMITS = {
  maxIops: 16000,
  maxThroughputMBps: 1000,
  maxSizeGiB: 16384,
  maxIopsPerGiB: 500,
  maxMBpsPerIops: 0.25,
} as const;

export const IO_VOLUME_TYPES = ['io1', 'io2'];

export const IO2_TIER1_MAX_IOPS = 32000;
