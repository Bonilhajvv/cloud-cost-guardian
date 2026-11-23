import { RecommendationType } from '../../common/enums';
import { addDays, toIsoDate } from '../../common/helpers/date.helper';
import { round } from '../../common/helpers/stats.helper';
import { DAYS_PER_MONTH } from '../../cost-reports/constants/cost-sync.constant';
import { DailyUsage } from '../../cost-reports/interfaces/cost-usage.interface';
import { COMMITMENT_USAGE_KEYS, HOURLY_RATE_MEASURED_TYPES, REMOVAL_TYPES } from '../constants/recommendation.constant';
import { MEASURE_MIN_DAYS, MEASURE_SETTLE_DAYS, MEASURE_WINDOW_DAYS, UNIQUE_RESOURCE_ID } from '../constants/realized-savings.constant';
import { Recommendation } from '../entities/recommendation.entity';
import { RealizedMeasurement, RealizedMeasurementInput } from '../interfaces/realized-measurement.interface';
import { isEc2Analysis } from '../../aws/core/helpers/resource-analysis.helper';

export function usageKeysOf(rec: Pick<Recommendation, 'type' | 'resourceId' | 'resourceArn' | 'metadata'>): string[] {
  const commitment = COMMITMENT_USAGE_KEYS[rec.type];
  if (commitment) return [commitment];
  const analysis = rec.metadata.analysis;
  if (rec.type === RecommendationType.EC2_STOPPED) return analysis && isEc2Analysis(analysis) ? (analysis.stoppedVolumes ?? []).map((v) => v.volumeId) : [];
  return [...(rec.resourceArn ? [rec.resourceArn] : []), ...(UNIQUE_RESOURCE_ID.test(rec.resourceId) ? [rec.resourceId] : [])];
}

function total(rows: readonly DailyUsage[], field: 'cost' | 'hours' | 'hourlyCost'): number {
  return rows.reduce((sum, r) => sum + r[field], 0);
}

export function measureRealizedSavings(input: RealizedMeasurementInput): RealizedMeasurement {
  const { type, usage, coveredDays } = input;
  const commitment = COMMITMENT_USAGE_KEYS[type] !== undefined;
  const change = toIsoDate(input.implementedAt);
  const others = (input.otherChanges ?? []).map(toIsoDate);
  const previousChange = others.filter((d) => d < change).sort().at(-1) ?? '';
  const nextChange = (input.otherChanges ?? []).filter((d) => toIsoDate(d) > change).sort((a, b) => a.getTime() - b.getTime())[0];
  const beforeFrom = toIsoDate(addDays(input.implementedAt, -(MEASURE_WINDOW_DAYS + 1)));
  const beforeTo = toIsoDate(addDays(input.implementedAt, -2));
  const windowEnd = toIsoDate(addDays(input.implementedAt, MEASURE_WINDOW_DAYS));
  const beforeNext = nextChange ? toIsoDate(addDays(nextChange, -2)) : windowEnd;
  const afterTo = beforeNext < windowEnd ? beforeNext : windowEnd;
  const settled = toIsoDate(addDays(input.now, -MEASURE_SETTLE_DAYS));
  const firstSeen = commitment ? '' : (usage[0]?.day ?? '');
  const beforeDays = coveredDays.filter((d) => d >= beforeFrom && d <= beforeTo && d >= firstSeen && d > previousChange);
  const afterDays = coveredDays.filter((d) => d > change && d <= afterTo && d <= settled);
  const pick = (days: readonly string[]) => {
    const set = new Set(days);
    return usage.filter((u) => set.has(u.day));
  };
  const before = pick(beforeDays);
  const after = pick(afterDays);
  const result = (status: RealizedMeasurement['status'], amount: number | null, reason: string | null, final = false): RealizedMeasurement => ({
    status,
    amount,
    beforeDays: beforeDays.length,
    afterDays: afterDays.length,
    final,
    reason,
    measuredAt: input.now.toISOString(),
  });
  const windowClosed = settled >= afterTo;

  if (others.includes(change)) return result('NOT_MEASURABLE', null, 'Another recommendation changed the same resource on the same day', windowClosed);
  if (!commitment && before.length === 0) return result('NOT_MEASURABLE', null, 'The cost export has no cost of this resource before the change', windowClosed);
  if (beforeDays.length < MEASURE_MIN_DAYS) return result('NOT_MEASURABLE', null, `Fewer than ${MEASURE_MIN_DAYS} days of cost before the change`, windowClosed);
  if (afterDays.length < MEASURE_MIN_DAYS) return result(windowClosed ? 'NOT_MEASURABLE' : 'PENDING', null, `Fewer than ${MEASURE_MIN_DAYS} days of cost after the change`, windowClosed);
  if (commitment && after.length === 0) return result(windowClosed ? 'NOT_MEASURABLE' : 'PENDING', null, 'No commitment usage after the change', windowClosed);
  if (!commitment && !REMOVAL_TYPES.includes(type) && after.length === 0) {
    return result('NOT_MEASURABLE', null, 'The resource has no cost after the change: it was removed or recreated with another id', windowClosed);
  }

  if (HOURLY_RATE_MEASURED_TYPES.includes(type)) {
    const hoursBefore = total(before, 'hours');
    const hoursAfter = total(after, 'hours');
    const activeDays = (rows: readonly DailyUsage[]) => rows.filter((r) => r.hours > 0).length;
    if (activeDays(before) < MEASURE_MIN_DAYS || activeDays(after) < MEASURE_MIN_DAYS) {
      return result(windowClosed ? 'NOT_MEASURABLE' : 'PENDING', null, `Fewer than ${MEASURE_MIN_DAYS} days of running hours before or after the change`, windowClosed);
    }
    const rateDifference = total(before, 'hourlyCost') / hoursBefore - total(after, 'hourlyCost') / hoursAfter;
    return result('MEASURED', round(rateDifference * (hoursAfter / afterDays.length) * DAYS_PER_MONTH), null, windowClosed);
  }
  const daily = total(before, 'cost') / beforeDays.length - total(after, 'cost') / afterDays.length;
  return result('MEASURED', round(daily * DAYS_PER_MONTH), null, windowClosed);
}
