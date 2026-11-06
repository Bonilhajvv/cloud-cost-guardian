export const SAME_SIZE_ALTERNATIVES: Record<string, string[]> = {
  t2: ['t3', 't3a'],
  t3: ['t3a', 't4g'],
  t3a: ['t4g'],
  m4: ['m6i', 'm6a'],
  m5: ['m6i', 'm6a', 'm7g'],
  m5a: ['m6a', 'm7g'],
  m6i: ['m6a', 'm7i', 'm7g'],
  m6a: ['m7a', 'm7g'],
  c4: ['c6i', 'c6a'],
  c5: ['c6i', 'c6a', 'c7g'],
  c6i: ['c6a', 'c7i', 'c7g'],
  r4: ['r6i', 'r6a'],
  r5: ['r6i', 'r6a', 'r7g'],
  r6i: ['r6a', 'r7i', 'r7g'],
};

export const OPTION_FIT_THRESHOLDS = {
  cpuP95Fits: 60,
  cpuP95Tight: 80,
  cpuMaxFits: 90,
  memoryP95Fits: 75,
  memoryP95Tight: 90,
} as const;
