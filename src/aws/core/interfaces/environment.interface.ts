export type Environment = 'PRODUCTION' | 'NON_PRODUCTION' | 'UNKNOWN';

export type ManualEnvironment = Exclude<Environment, 'UNKNOWN'>;

export type EnvironmentSource = 'MANUAL' | 'TAG' | 'NAME';

export interface EnvironmentInfo {
  environment: Environment;
  source: EnvironmentSource | null;
  detail: string | null;
}
