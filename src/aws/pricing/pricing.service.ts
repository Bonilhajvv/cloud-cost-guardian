import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import {
  DEFAULT_PRICING_OS,
  PRICE_CACHE_TTL_MS,
  PRICING_API_REGION,
  PRICING_OS_BY_PLATFORM,
} from './constants/pricing.constant';
import { hourlyToMonthly, parseOnDemandHourlyUsd, parseOnDemandUsd } from './helpers/parse-price-list.helper';
import { CachedPrice, OnDemandPriceQuery, PriceFilter } from './interfaces/on-demand-price.interface';

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
      const price = await this.lookup(`ebs|${region}|${volumeType}`, { region, volumeType }, [
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Storage' },
        { Type: 'TERM_MATCH', Field: 'volumeApiName', Value: volumeType },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
      ], (item) => parseOnDemandUsd(item, 'GB-Mo'));
      if (price !== null) out[volumeType] = price;
    }
    return out;
  }

  private getEc2MonthlyPrice(query: OnDemandPriceQuery): Promise<number | null> {
    return this.lookup(`ec2|${query.region}|${query.instanceType}|${query.operatingSystem}`, { ...query }, [
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

  private async lookup(
    key: string,
    query: Record<string, string>,
    filters: PriceFilter[],
    parse: (item: string) => number | null,
  ): Promise<number | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.monthly;
    if (this.disabledUntil > Date.now()) return null;

    let monthly: number | null = null;
    try {
      const { PriceList } = await this.client.send(
        new GetProductsCommand({ ServiceCode: 'AmazonEC2', MaxResults: 10, Filters: filters }),
      );
      const items = Array.isArray(PriceList) ? PriceList.map(String) : [];
      monthly = items.map(parse).find((p): p is number => p !== null) ?? null;
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

    this.cache.set(key, { monthly, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
    this.logger.log({ msg: 'On-demand price resolved', ...query, price: monthly });
    return monthly;
  }
}
