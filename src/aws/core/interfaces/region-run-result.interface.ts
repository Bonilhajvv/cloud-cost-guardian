export interface RegionFailure {
  region: string;
  code: string;
  message: string;
}

export interface RegionRunResult<T> {
  results: { region: string; value: T }[];
  failures: RegionFailure[];
}
