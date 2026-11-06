export const BURSTABLE_FAMILIES = ['t2', 't3', 't3a', 't4g'];

export const BURSTABLE_BASELINE_PERCENT: Record<string, number> = {
  nano: 5,
  micro: 10,
  small: 20,
  medium: 20,
  large: 30,
  xlarge: 40,
  '2xlarge': 40,
};

export const T2_BASELINE_OVERRIDES: Record<string, number> = {
  xlarge: 22.5,
  '2xlarge': 17,
};
