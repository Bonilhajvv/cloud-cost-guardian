import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import {
  DEFAULT_PRICING_OS,
  EC2_SERVICE,
  PRICE_CACHE_TTL_MS,
  PRICING_API_REGION,
  PRICING_OS_BY_PLATFORM,
  RDS_PRICING_ENGINES,
  RDS_SERVICE,
} from './constants/pricing.constant';
import { hourlyToMonthly, parseOnDemandHourlyUsd, parseOnDemandUsd, parseProductAttribute } from './helpers/parse-price-list.helper';
import { RdsDeployment, RdsExtendedSupportYear, RdsInstancePrice } from './interfaces/rds-price.interface';
import { CachedPrice, OnDemandPriceQuery, PriceFilter } from './interfaces/on-demand-price.interface';
import { EbsPerformancePrices } from './interfaces/ebs-performance-price.interface';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private readonly client: PricingClient;
  private readonly cache = new Map<string, CachedPrice>();
  private disabledUntil = 0;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.client = new PricingClient({
      region: PRICING_API_REGION,
      maxAttempts: config.get('AWS_MAX_ATTEMPTS', { infer: true }),
      retryMode: 'adaptive',
    });
  }

  pricingOs(platform: string | null): string | null {
    if (!platform) return DEFAULT_PRICING_OS;
    return PRICING_OS_BY_PLATFORM[platform] ?? null;
  }

  async getEc2MonthlyPrices(
    region: string,
    instanceTypes: readonly string[],
    operatingSystem: string,
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const instanceType of new Set(instanceTypes)) {
      const monthly = await this.getEc2MonthlyPrice({ region, instanceType, operatingSystem });
      if (monthly !== null) out[instanceType] = monthly;
    }
    return out;
  }

  async getEbsMonthlyPricePerGb(region: string, volumeTypes: readonly string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const volumeType of new Set(volumeTypes)) {
      const price = await this.lookup<number>(EC2_SERVICE, `ebs|${region}|${volumeType}`, { region, volumeType }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Storage' },
        { Type: 'TERM_MATCH', Field: 'volumeApiName', Value: volumeType },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      ], (item) => parseOnDemandUsd(item, 'GB-Mo'));
      if (price !== null) out[volumeType] = price;
    }
    return out;
  }

  async getEbsPerformancePrices(region: string, volumeTypes: readonly string[]): Promise<EbsPerformancePrices> {
    const out: EbsPerformancePrices = { iopsMonth: {}, throughputMBpsMonth: {} };
    for (const volumeType of new Set(volumeTypes)) {
      const iops = await this.lookup<number>(EC2_SERVICE, `ebs-iops|${region}|${volumeType}`, { region, volumeType, dimension: 'iops' }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'System Operation' },
        { Type: 'TERM_MATCH', Field: 'group', Value: 'EBS IOPS' },
        { Type: 'TERM_MATCH', Field: 'volumeApiName', Value: volumeType },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      ], (item) => parseOnDemandUsd(item, 'IOPS-Mo'));
      if (iops !== null) out.iopsMonth[volumeType] = iops;
      if (volumeType !== 'gp3') continue;
      const throughput = await this.lookup<number>(EC2_SERVICE, `ebs-throughput|${region}|${volumeType}`, { region, volumeType, dimension: 'throughput' }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Provisioned Throughput' },
        { Type: 'TERM_MATCH', Field: 'volumeApiName', Value: volumeType },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      ], (item) => {
        const perGiBps = parseOnDemandUsd(item, 'GiBps-mo');
        return perGiBps === null ? null : perGiBps / 1024;
      });
      if (throughput !== null) out.throughputMBpsMonth[volumeType] = throughput;
    }
    return out;
  }

  private getEc2MonthlyPrice(query: OnDemandPriceQuery): Promise<number | null> {
    return this.lookup<number>(EC2_SERVICE, `ec2|${query.region}|${query.instanceType}|${query.operatingSystem}`, { ...query }, [
      { Type: 'TERM_MATCH', Field: 'instanceType', Value: query.instanceType },
      { Type: 'TERM_MATCH', Field: 'regionCode', Value: query.region },
      { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: query.operatingSystem },
      { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
      { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
      { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
      { Type: 'TERM_MATCH', Field: 'licenseModel', Value: 'No License required' },
    ], (item) => {
      const hourly = parseOnDemandHourlyUsd(item);
      return hourly === null ? null : hourlyToMonthly(hourly);
    });
  }

  async getRdsInstancePrices(
    region: string,
    engine: string,
    deployment: RdsDeployment,
    instanceClasses: readonly string[],
  ): Promise<Record<string, RdsInstancePrice>> {
    const databaseEngine = RDS_PRICING_ENGINES[engine];
    const out: Record<string, RdsInstancePrice> = {};
    if (!databaseEngine) return out;
    for (const instanceClass of new Set(instanceClasses)) {
      const price = await this.lookup<RdsInstancePrice>(RDS_SERVICE, `rds|${region}|${engine}|${deployment}|${instanceClass}`, { region, engine, deployment, instanceClass }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Database Instance' },
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceClass },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: databaseEngine },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: deployment },
      ], (item) => {
        const hourly = parseOnDemandHourlyUsd(item);
        const vcpu = Number(parseProductAttribute(item, 'vcpu'));
        return hourly === null ? null : { monthly: hourlyToMonthly(hourly), vcpu: Number.isFinite(vcpu) && vcpu > 0 ? vcpu : null };
      });
      if (price) out[instanceClass] = price;
    }
    return out;
  }

  getRdsExtendedSupportHourlyPerVcpu(region: string, engine: string, majorVersion: string, year: RdsExtendedSupportYear): Promise<number | null> {
    const databaseEngine = RDS_PRICING_ENGINES[engine];
    if (!databaseEngine) return Promise.resolve(null);
    return this.lookup<number>(RDS_SERVICE, `rds-es|${region}|${engine}|${majorVersion}|${year}`, { region, engine, majorVersion, year }, [
      { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: databaseEngine },
      { Type: 'TERM_MATCH', Field: 'engineMajorVersion', Value: majorVersion },
      { Type: 'TERM_MATCH', Field: 'extendedSupportPricingYear', Value: year },
    ], (item) => parseOnDemandUsd(item, 'vCPU-hour'));
  }

  private async lookup<T>(
    serviceCode: string,
    key: string,
    query: Record<string, string>,
    filters: PriceFilter[],
    parse: (item: string) => T | null,
  ): Promise<T | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T | null;
    if (this.disabledUntil > Date.now()) return null;

    let monthly: T | null = null;
    try {
      const { PriceList } = await this.client.send(
        new GetProductsCommand({ ServiceCode: serviceCode, MaxResults: 10, Filters: filters }),
      );
      const items = Array.isArray(PriceList) ? PriceList.map(String) : [];
      monthly = items.map(parse).find((p): p is T => p !== null) ?? null;
    } catch (error) {
      const err = toAwsIntegrationError(error, 'Pricing GetProducts');
      if (err.code === 'ACCESS_DENIED') {
        this.disabledUntil = Date.now() + PRICE_CACHE_TTL_MS;
        this.logger.warn({ msg: 'Pricing API denied for platform identity; on-demand prices disabled for 24h', error: err.message });
      } else {
        this.logger.warn({ msg: 'Pricing lookup failed', ...query, code: err.code, error: err.message });
      }
      return null;
    }

    this.cache.set(key, { value: monthly, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
    this.logger.log({ msg: 'On-demand price resolved', ...query, price: monthly });
    return monthly;
  }
}
