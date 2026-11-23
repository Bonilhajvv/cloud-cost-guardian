export const SNAPSHOT_MIN_AGE_DAYS = 90;

export const MANAGED_SNAPSHOT_TAG_KEYS = ['aws:backup:source-resource', 'aws:dlm:lifecycle-policy-id'];

export const PLACEHOLDER_VOLUME_ID = 'vol-ffffffff';

export const CREATE_IMAGE_PATTERN = /^Created by CreateImage\([^)]*\) for (ami-[0-9a-f]+)/;
