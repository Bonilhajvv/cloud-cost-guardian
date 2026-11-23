export type LambdaArchitecture = 'x86_64' | 'arm64';

export interface LambdaPrices {
  durationGbSecond: Record<LambdaArchitecture, number | null>;
  provisionedGbSecond: Record<LambdaArchitecture, number | null>;
}
