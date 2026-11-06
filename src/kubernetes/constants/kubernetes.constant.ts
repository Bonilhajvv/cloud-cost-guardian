export const INSTALL_TOKEN_PREFIX = 'ccg_inst_';

export const AGENT_TOKEN_PREFIX = 'ccg_agent_';

export const INSTALL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const CLUSTER_STALE_AFTER_MS = 15 * 60 * 1000;

export const USAGE_SAMPLE_RETENTION_DAYS = 30;

export const NODE_STATS_DAYS = 14;

export const AGENT_NAMESPACE = 'ccg-system';

export const AGENT_REPORT_PATH = '/api/v1/agent/k8s/report';

export const INSTALL_MANIFEST_PATH = '/api/v1/install/k8s';

export const MAX_REPORT_NODES = 5000;

export const MAX_REPORT_WORKLOADS = 20000;

export const GIB = 1024 ** 3;

export const INGEST_BATCH_SIZE = 500;
