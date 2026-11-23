export const EKS_TOKEN_PREFIX = 'k8s-aws-v1.';

export const EKS_TOKEN_TTL_SECONDS = 60;

export const EKS_CLUSTER_HEADER = 'x-k8s-aws-id';

export const EKS_ENDPOINT_PATTERN = /^https:\/\/[A-Za-z0-9.-]+\.(eks\.amazonaws\.com(\.cn)?|eks\.[a-z0-9-]+\.api\.aws)$/;

export const EKS_REQUEST_TIMEOUT_MS = 30_000;

export const EKS_PAGE_SIZE = 500;

export const EKS_MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

export const EKS_MAX_ITEMS = 200_000;
