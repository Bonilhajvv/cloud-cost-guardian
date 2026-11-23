import { RdsInstancePrice } from './rds-price.interface';

export interface AuroraModePrices {
  byClass: Record<string, RdsInstancePrice>;
  acuHour: number | null;
  storageGbMonth: number | null;
}

export interface AuroraPrices {
  standard: AuroraModePrices;
  ioOptimized: AuroraModePrices;
  ioRequest: number | null;
}
