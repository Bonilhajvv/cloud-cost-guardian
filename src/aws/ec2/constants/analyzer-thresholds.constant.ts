export const ANALYZER_THRESHOLDS = {
  minDatapoints: 7 * 24,
  fullCoverageDatapoints: Math.floor(14 * 24 * 0.9),
  idleCpuP95: 5,
  idleCpuMax: 10,
  idleNetworkMbPerDay: 5,
  heuristicCpuP95: 40,
  heuristicCpuMax: 70,
  projectedCpuP95Limit: 70,
  projectedMemoryP95Limit: 80,
  severityHigh: 200,
  severityMedium: 50,
  diskHighUsedPercent: 85,
} as const;
