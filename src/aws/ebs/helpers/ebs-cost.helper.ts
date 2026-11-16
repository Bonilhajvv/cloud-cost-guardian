import { EbsPerformancePrices } from '../../pricing/interfaces/ebs-performance-price.interface';
import { VolumeShape } from '../interfaces/ebs-volume.interface';
import { GP3_BASELINE_IOPS, GP3_BASELINE_THROUGHPUT_MBPS, IO2_TIER1_MAX_IOPS, IO_VOLUME_TYPES } from '../constants/ebs.constant';

export function provisionedPerformanceCost(shape: VolumeShape, prices: EbsPerformancePrices | undefined): number | null {
  if (shape.volumeType === 'gp3') {
    const extraIops = Math.max(0, (shape.iops ?? GP3_BASELINE_IOPS) - GP3_BASELINE_IOPS);
    const extraThroughput = Math.max(0, (shape.throughputMBps ?? GP3_BASELINE_THROUGHPUT_MBPS) - GP3_BASELINE_THROUGHPUT_MBPS);
    const iopsPrice = prices?.iopsMonth.gp3;
    const throughputPrice = prices?.throughputMBpsMonth.gp3;
    if ((extraIops > 0 && iopsPrice === undefined) || (extraThroughput > 0 && throughputPrice === undefined)) return null;
    return extraIops * (iopsPrice ?? 0) + extraThroughput * (throughputPrice ?? 0);
  }
  if (IO_VOLUME_TYPES.includes(shape.volumeType)) {
    const price = prices?.iopsMonth[shape.volumeType];
    if (!shape.iops || price === undefined) return null;
    if (shape.volumeType === 'io2' && shape.iops > IO2_TIER1_MAX_IOPS) return null;
    return shape.iops * price;
  }
  return 0;
}

export function volumeMonthlyCost(
  shape: VolumeShape,
  pricePerGbMonth: Record<string, number>,
  prices: EbsPerformancePrices | undefined,
): number | null {
  const perGb = pricePerGbMonth[shape.volumeType];
  const performance = provisionedPerformanceCost(shape, prices);
  return perGb === undefined || performance === null ? null : shape.sizeGiB * perGb + performance;
}
