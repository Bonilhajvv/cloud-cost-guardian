import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import {
  AURORA_PRICING_ENGINES,
  DEFAULT_PRICING_OS,
  EC2_SERVICE,
  ELB_SERVICE,
  LAMBDA_SERVICE,
  PRICE_CACHE_TTL_MS,
  PRICING_API_REGION,
  PRICING_OS_BY_PLATFORM,
  RDS_IOPS_USAGE,
  RDS_PRICING_ENGINES,
  RDS_SERVICE,
  RDS_STORAGE_USAGE,
  S3_SERVICE,
  VPC_SERVICE,
} from './constants/pricing.constant';
import { hourlyToMonthly, parseFirstTierUsd, parseMemoryGb, parseOnDemandHourlyUsd, parseOnDemandUsd, parseProductAttribute, usageTypeMatches } from './helpers/parse-price-list.helper';
import { AuroraModePrices, AuroraPrices } from './interfaces/aurora-price.interface';
import { LambdaPrices } from './interfaces/lambda-price.interface';
import { RdsDeployment, RdsExtendedSupportYear, RdsInstancePrice, RdsStoragePrices } from './interfaces/rds-price.interface';
import { NetworkPrices } from '../network/interfaces/network.interface';
import { LOAD_BALANCER_PRICING_FAMILIES } from '../network/constants/network.constant';
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
        return hourly === null ? null : { monthly: hourlyToMonthly(hourly), vcpu: Number.isFinite(vcpu) && vcpu > 0 ? vcpu : null, memoryGb: parseMemoryGb(item) };
      });
      if (price) out[instanceClass] = price;
    }
    return out;
  }

  getRdsExtendedSupportHourlyPerVcpu(region: string, engine: string, majorVersion: string, year: RdsExtendedSupportYear): Promise<number | null> {
    const databaseEngine = RDS_PRICING_ENGINES[engine] ?? AURORA_PRICING_ENGINES[engine];
    if (!databaseEngine) return Promise.resolve(null);
    return this.lookup<number>(RDS_SERVICE, `rds-es|${region}|${engine}|${majorVersion}|${year}`, { region, engine, majorVersion, year }, [
      { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: databaseEngine },
      { Type: 'TERM_MATCH', Field: 'engineMajorVersion', Value: majorVersion },
      { Type: 'TERM_MATCH', Field: 'extendedSupportPricingYear', Value: year },
    ], (item) => parseOnDemandUsd(item, 'vCPU-hour'));
  }

  async getRdsStoragePrices(region: string, deployment: RdsDeployment, storageTypes: readonly string[]): Promise<RdsStoragePrices> {
    const out: RdsStoragePrices = { gbMonth: {}, iopsMonth: {} };
    const prefix = deployment === 'Multi-AZ' ? 'Multi-AZ-' : '';
    for (const storageType of new Set(storageTypes)) {
      const storage = RDS_STORAGE_USAGE[storageType];
      if (!storage) continue;
      const gb = await this.lookup<number>(RDS_SERVICE, `rds-storage|${region}|${deployment}|${storageType}`, { region, deployment, storageType }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Database Storage' },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
        { Type: 'TERM_MATCH', Field: 'volumeType', Value: storage.volumeType },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: deployment },
      ], (item) => (usageTypeMatches(item, `RDS:${prefix}${storage.usage}`) ? parseOnDemandUsd(item, 'GB-Mo') : null), 100);
      if (gb !== null) out.gbMonth[storageType] = gb;
      const iopsUsage = RDS_IOPS_USAGE[storageType];
      if (!iopsUsage) continue;
      const iops = await this.lookup<number>(RDS_SERVICE, `rds-iops|${region}|${deployment}|${storageType}`, { region, deployment, storageType, dimension: 'iops' }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Provisioned IOPS' },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: deployment },
      ], (item) => (usageTypeMatches(item, `RDS:${prefix}${iopsUsage}`) ? parseOnDemandUsd(item, 'IOPS-Mo') : null), 100);
      if (iops !== null) out.iopsMonth[storageType] = iops;
    }
    return out;
  }

  async getAuroraInstancePrices(region: string, engine: string, ioOptimized: boolean, instanceClasses: readonly string[]): Promise<Record<string, RdsInstancePrice>> {
    const out: Record<string, RdsInstancePrice> = {};
    const databaseEngine = AURORA_PRICING_ENGINES[engine];
    if (!databaseEngine) return out;
    const usage = ioOptimized ? 'InstanceUsageIOOptimized' : 'InstanceUsage';
    for (const instanceClass of new Set(instanceClasses)) {
      const price = await this.lookup<RdsInstancePrice>(RDS_SERVICE, `aurora|${region}|${engine}|${ioOptimized}|${instanceClass}`, { region, engine, instanceClass, usage }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Database Instance' },
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceClass },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: databaseEngine },
      ], (item) => {
        if (!usageTypeMatches(item, `${usage}:${instanceClass}`)) return null;
        const hourly = parseOnDemandHourlyUsd(item);
        const vcpu = Number(parseProductAttribute(item, 'vcpu'));
        return hourly === null ? null : { monthly: hourlyToMonthly(hourly), vcpu: Number.isFinite(vcpu) && vcpu > 0 ? vcpu : null, memoryGb: parseMemoryGb(item) };
      }, 100);
      if (price) out[instanceClass] = price;
    }
    return out;
  }

  async getAuroraPrices(region: string, engine: string, instanceClasses: readonly string[]): Promise<AuroraPrices> {
    const databaseEngine = AURORA_PRICING_ENGINES[engine] ?? '';
    const rate = (productFamily: string, usage: string, unit: string, engineFilter = 'Any') =>
      this.lookup<number>(RDS_SERVICE, `aurora-rate|${region}|${engine}|${usage}`, { region, engine, usage }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: productFamily },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: engineFilter },
      ], (item) => (usageTypeMatches(item, usage) ? parseOnDemandUsd(item, unit) : null), 100);
    const mode = async (ioOptimized: boolean): Promise<AuroraModePrices> => ({
      byClass: await this.getAuroraInstancePrices(region, engine, ioOptimized, instanceClasses),
      acuHour: await rate('ServerlessV2', ioOptimized ? 'Aurora:ServerlessV2IOOptimizedUsage' : 'Aurora:ServerlessV2Usage', 'ACU-Hr', databaseEngine),
      storageGbMonth: await rate('Database Storage', ioOptimized ? 'Aurora:IO-OptimizedStorageUsage' : 'Aurora:StorageUsage', 'GB-Mo'),
    });
    return {
      standard: await mode(false),
      ioOptimized: await mode(true),
      ioRequest: await rate('System Operation', 'Aurora:StorageIOUsage', 'IOs'),
    };
  }

  async getS3StoragePrices(region: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [key, usage] of Object.entries({ standard: 'TimedStorage-ByteHrs', infrequentAccess: 'TimedStorage-SIA-ByteHrs' })) {
      const price = await this.lookup<number>(S3_SERVICE, `s3|${region}|${usage}`, { region, usage }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Storage' },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      ], (item) => (usageTypeMatches(item, usage) ? parseFirstTierUsd(item, 'GB-Mo') : null), 100);
      if (price !== null) out[key] = price;
    }
    return out;
  }

  async getLambdaPrices(region: string): Promise<LambdaPrices> {
    const rate = (group: string, usage: string) =>
      this.lookup<number>(LAMBDA_SERVICE, `lambda|${region}|${group}`, { region, group }, [
        { Type: 'TERM_MATCH', Field: 'group', Value: group },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      ], (item) => (usageTypeMatches(item, usage) ? parseFirstTierUsd(item, 'Lambda-GB-Second') : null), 100);
    return {
      durationGbSecond: { x86_64: await rate('AWS-Lambda-Duration', 'Lambda-GB-Second'), arm64: await rate('AWS-Lambda-Duration-ARM', 'Lambda-GB-Second-ARM') },
      provisionedGbSecond: {
        x86_64: await rate('AWS-Lambda-Provisioned-Concurrency', 'Lambda-Provisioned-Concurrency'),
        arm64: await rate('AWS-Lambda-Provisioned-Concurrency-ARM', 'Lambda-Provisioned-Concurrency-ARM'),
      },
    };
  }

  getEbsSnapshotPricePerGb(region: string): Promise<number | null> {
    return this.lookup<number>(EC2_SERVICE, `ebs-snapshot|${region}`, { region, product: 'ebs-snapshot' }, [
      { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Storage Snapshot' },
      { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
    ], (item) => {
      const type = parseProductAttribute(item, 'usagetype');
      return type && /^([A-Z]+\d+-)?EBS:SnapshotUsage$/.test(type) ? parseOnDemandUsd(item, 'GB-Mo') : null;
    }, 20);
  }

  async getNetworkPrices(region: string): Promise<NetworkPrices> {
    const hourly = (usage: RegExp) => (item: string) => {
      const type = parseProductAttribute(item, 'usagetype');
      return type && usage.test(type) ? parseOnDemandHourlyUsd(item) : null;
    };
    const publicIpv4Hourly = await this.lookup<number>(VPC_SERVICE, `ipv4|${region}`, { region, product: 'public-ipv4' }, [
      { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      { Type: 'TERM_MATCH', Field: 'group', Value: 'VPCPublicIPv4Address' },
    ], hourly(/^([A-Z]+\d+-)?PublicIPv4:InUseAddress$/), 100);
    const natFilters: PriceFilter[] = [
      { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'NAT Gateway' },
      { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
    ];
    const natGatewayHourly = await this.lookup<number>(EC2_SERVICE, `nat-hours|${region}`, { region, product: 'nat-hours' }, natFilters, hourly(/^([A-Z]+\d+-)?NatGateway-Hours$/), 100);
    const natGatewayPerGb = await this.lookup<number>(EC2_SERVICE, `nat-gb|${region}`, { region, product: 'nat-gb' }, natFilters, (item) => {
      const type = parseProductAttribute(item, 'usagetype');
      return type && /^([A-Z]+\d+-)?NatGateway-Bytes$/.test(type) ? parseOnDemandUsd(item, 'GB') : null;
    }, 100);
    const loadBalancerHourly: Record<string, number> = {};
    for (const [type, family] of Object.entries(LOAD_BALANCER_PRICING_FAMILIES)) {
      const price = await this.lookup<number>(ELB_SERVICE, `lb|${region}|${type}`, { region, product: family }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: family },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      ], hourly(/^([A-Z]+\d+-)?LoadBalancerUsage$/), 100);
      if (price !== null) loadBalancerHourly[type] = price;
    }
    return { publicIpv4Hourly, natGatewayHourly, natGatewayPerGb, loadBalancerHourly };
  }

  private async lookup<T>(
    serviceCode: string,
    key: string,
    query: Record<string, string>,
    filters: PriceFilter[],
    parse: (item: string) => T | null,
    maxResults = 10,
  ): Promise<T | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T | null;
    if (this.disabledUntil > Date.now()) return null;

    let monthly: T | null = null;
    try {
      const { PriceList } = await this.client.send(
        new GetProductsCommand({ ServiceCode: serviceCode, MaxResults: maxResults, Filters: filters }),
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
