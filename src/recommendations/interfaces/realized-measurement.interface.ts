import { RecommendationType } from '../../common/enums';
import { DailyUsage } from '../../cost-reports/interfaces/cost-usage.interface';

export type RealizedMeasurementStatus = 'MEASURED' | 'PENDING' | 'NOT_MEASURABLE';

export interface RealizedMeasurement {
  status: RealizedMeasurementStatus;
  amount: number | null;
  beforeDays: number;
  afterDays: number;
  final: boolean;
  reason: string | null;
  measuredAt: string;
}

export interface RealizedMeasurementInput {
  type: RecommendationType;
  implementedAt: Date;
  otherChanges?: readonly Date[];
  coveredDays: readonly string[];
  usage: readonly DailyUsage[];
  now: Date;
}
