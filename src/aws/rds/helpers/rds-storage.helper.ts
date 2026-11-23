import { round } from '../../../common/helpers/stats.helper';
import { RdsStoragePrices } from '../../pricing/interfaces/rds-price.interface';
import { RDS_GP3_BASELINE, RDS_GP3_LARGE_GB, RDS_IO_STORAGE_TYPES } from '../constants/rds.constant';
import { RdsInstance } from '../interfaces/rds-instance.interface';

export function gp3Baseline(sizeGb: number): { iops: number; mbps: number } {
  return sizeGb >= RDS_GP3_LARGE_GB ? RDS_GP3_BASELINE.large : RDS_GP3_BASELINE.small;
}

export function storageMonthlyCost(instance: Pick<RdsInstance, 'storageType' | 'allocatedStorageGb' | 'iops'>, prices: RdsStoragePrices | null | undefined): number | null {
  const { storageType, allocatedStorageGb, iops } = instance;
  if (!prices || !storageType || allocatedStorageGb === null) return null;
  const perGb = prices.gbMonth[storageType];
  if (perGb === undefined) return null;
  if (!RDS_IO_STORAGE_TYPES.includes(storageType)) return round(perGb * allocatedStorageGb);
  const perIops = prices.iopsMonth[storageType];
  if (perIops === undefined || !iops) return null;
  return round(perGb * allocatedStorageGb + perIops * iops);
}
