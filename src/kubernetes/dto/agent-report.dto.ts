import { Type } from 'class-transformer';
import {
  IsIP,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_REPORT_CONTAINERS, MAX_REPORT_NODES, MAX_REPORT_WORKLOADS } from '../constants/kubernetes.constant';
import { HOP_KINDS, MAX_REPORT_ROUTES, MAX_ROUTE_HOPS } from '../constants/request-cost.constant';

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

export class FilesystemDto {
  @IsNumber()
  @Min(0)
  usedBytes: number;

  @IsNumber()
  @Min(0)
  capacityBytes: number;
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
  @IsIP()
  internalIp?: string;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => FilesystemDto)
  filesystem?: FilesystemDto;

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

export class ReportContainerDto {
  @IsString()
  @MaxLength(253)
  name: string;

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REPORT_CONTAINERS)
  @ValidateNested({ each: true })
  @Type(() => ReportContainerDto)
  containers?: ReportContainerDto[];
}

export class RequestHopDto {
  @IsIn(HOP_KINDS)
  kind: (typeof HOP_KINDS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(253)
  namespace?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  workloadKind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  workloadName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  target?: string;

  @IsInt()
  @Min(0)
  spans: number;

  @IsNumber()
  @Min(0)
  durationMs: number;
}

export class RequestRouteDto {
  @IsString()
  @MaxLength(253)
  entryService: string;

  @IsString()
  @MaxLength(253)
  entryRoute: string;

  @IsInt()
  @Min(0)
  requests: number;

  @IsNumber()
  @Min(0)
  durationMs: number;

  @IsArray()
  @ArrayMaxSize(MAX_ROUTE_HOPS)
  @ValidateNested({ each: true })
  @Type(() => RequestHopDto)
  hops: RequestHopDto[];
}

export class RequestUsageDto {
  @IsDateString()
  windowStart: string;

  @IsDateString()
  windowEnd: string;

  @IsNumber()
  @Min(0.0001)
  @Max(1)
  sampleRatio: number;

  @IsInt()
  @Min(0)
  droppedTraces: number;

  @IsArray()
  @ArrayMaxSize(MAX_REPORT_ROUTES)
  @ValidateNested({ each: true })
  @Type(() => RequestRouteDto)
  routes: RequestRouteDto[];
}

export class AgentReportDto {
  @IsString()
  @MaxLength(32)
  agentVersion: string;

  @IsIn(['kubectl', 'helm', 'unknown'])
  installMethod: 'kubectl' | 'helm' | 'unknown';

  @IsOptional()
  @IsUUID()
  clusterUid?: string;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => RequestUsageDto)
  requests?: RequestUsageDto;
}
