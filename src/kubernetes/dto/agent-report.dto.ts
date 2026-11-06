import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_REPORT_NODES, MAX_REPORT_WORKLOADS } from '../constants/kubernetes.constant';

export class ResourceAmountDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  cpuCores?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  memoryBytes?: number | null;
}

export class ReportNodeDto {
  @IsString()
  @MaxLength(253)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  providerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  instanceType?: string;

  @IsIn(['control-plane', 'worker'])
  role: 'control-plane' | 'worker';

  @IsOptional()
  @IsObject()
  labels?: Record<string, string>;

  @ValidateNested()
  @Type(() => ResourceAmountDto)
  capacity: ResourceAmountDto;

  @ValidateNested()
  @Type(() => ResourceAmountDto)
  allocatable: ResourceAmountDto;

  @ValidateNested()
  @Type(() => ResourceAmountDto)
  requests: ResourceAmountDto;

  @ValidateNested()
  @Type(() => ResourceAmountDto)
  limits: ResourceAmountDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ResourceAmountDto)
  usage?: ResourceAmountDto;

  @IsInt()
  @Min(0)
  podCount: number;
}

export class ReportHpaDto {
  @IsOptional()
  @IsInt()
  minReplicas?: number | null;

  @IsInt()
  maxReplicas: number;
}

export class ReportWorkloadDto {
  @IsString()
  @MaxLength(253)
  namespace: string;

  @IsString()
  @MaxLength(32)
  kind: string;

  @IsString()
  @MaxLength(253)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  desiredReplicas?: number | null;

  @IsInt()
  @Min(0)
  podCount: number;

  @ValidateNested()
  @Type(() => ResourceAmountDto)
  requests: ResourceAmountDto;

  @ValidateNested()
  @Type(() => ResourceAmountDto)
  limits: ResourceAmountDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ResourceAmountDto)
  usage?: ResourceAmountDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportHpaDto)
  hpa?: ReportHpaDto | null;
}

export class AgentReportDto {
  @IsString()
  @MaxLength(32)
  agentVersion: string;

  @IsIn(['kubectl', 'helm', 'unknown'])
  installMethod: 'kubectl' | 'helm' | 'unknown';

  @IsString()
  @MaxLength(64)
  kubernetesVersion: string;

  @IsBoolean()
  metricsServerAvailable: boolean;

  @IsDateString()
  collectedAt: string;

  @IsArray()
  @ArrayMaxSize(MAX_REPORT_NODES)
  @ValidateNested({ each: true })
  @Type(() => ReportNodeDto)
  nodes: ReportNodeDto[];

  @IsArray()
  @ArrayMaxSize(MAX_REPORT_WORKLOADS)
  @ValidateNested({ each: true })
  @Type(() => ReportWorkloadDto)
  workloads: ReportWorkloadDto[];
}
