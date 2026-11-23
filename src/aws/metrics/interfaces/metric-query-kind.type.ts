export type QueryKind = 'cpuAvg' | 'cpuMax' | 'netIn' | 'netOut' | 'mem' | 'creditMin' | 'surplus' | 'disk';

export type RdsQueryKind = 'cpuAvg' | 'cpuMax' | 'connections' | 'freeStorage' | 'readIops' | 'writeIops' | 'readBytes' | 'writeBytes';

export type EbsQueryKind = 'readOps' | 'writeOps' | 'readBytes' | 'writeBytes' | 'burstBalance';
