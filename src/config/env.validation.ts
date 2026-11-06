import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Transform(({ value }) => Number(value))
  @IsInt()
  PORT = 3000;

  @Transform(toBool)
  @IsBoolean()
  LOG_JSON = false;

  @Transform(toBool)
  @IsBoolean()
  SWAGGER_ENABLED = true;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsString()
  DATABASE_URL: string;

  @Transform(toBool)
  @IsBoolean()
  DATABASE_SSL = false;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  DATABASE_POOL_SIZE = 10;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_REFRESH_TTL = '7d';

  @IsString()
  AWS_REGION = 'us-east-1';

  @Matches(/^\d{12}$/)
  AWS_PLATFORM_ACCOUNT_ID: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(900)
  @Max(43200)
  AWS_ASSUME_ROLE_DURATION_SECONDS = 3600;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  AWS_MAX_ATTEMPTS = 6;

  @Transform(toBool)
  @IsBoolean()
  JOBS_ENABLED = true;

  @IsString()
  PUBLIC_API_URL = 'http://localhost:3000';

  @IsString()
  @MinLength(32)
  AGENT_TOKEN_SECRET: string;

  @IsString()
  K8S_AGENT_IMAGE = 'ghcr.io/your-org/ccg-k8s-agent:0.1.0';

  @IsString()
  K8S_AGENT_HELM_CHART = 'oci://ghcr.io/your-org/charts/ccg-k8s-agent';

  @IsOptional()
  @IsString()
  CFN_TEMPLATE_URL?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return validated;
}
