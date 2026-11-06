import { AwsErrorCode } from '../interfaces/aws-error-code.type';
export class AwsIntegrationError extends Error {
  constructor(
    readonly code: AwsErrorCode,
    message: string,
    readonly awsErrorName?: string,
  ) {
    super(message);
    this.name = 'AwsIntegrationError';
  }
}

const CODE_BY_NAME: Record<string, AwsErrorCode> = {
  AccessDenied: 'ACCESS_DENIED',
  AccessDeniedException: 'ACCESS_DENIED',
  UnauthorizedOperation: 'ACCESS_DENIED',
  UnauthorizedException: 'ACCESS_DENIED',
  ExpiredToken: 'ACCESS_DENIED',
  OptInRequiredException: 'NOT_ENROLLED',
  Throttling: 'THROTTLED',
  ThrottlingException: 'THROTTLED',
  RequestLimitExceeded: 'THROTTLED',
  TooManyRequestsException: 'THROTTLED',
  LimitExceededException: 'THROTTLED',
  ValidationError: 'INVALID_CONFIGURATION',
  ValidationException: 'INVALID_CONFIGURATION',
  InvalidParameterValueException: 'INVALID_CONFIGURATION',
  MalformedPolicyDocument: 'INVALID_CONFIGURATION',
  DataUnavailableException: 'DATA_UNAVAILABLE',
};

export function toAwsIntegrationError(error: unknown, context?: string): AwsIntegrationError {
  if (error instanceof AwsIntegrationError) return error;
  const name = error instanceof Error ? error.name : 'Unknown';
  const message = error instanceof Error ? error.message : String(error);
  const code = CODE_BY_NAME[name] ?? 'UNKNOWN';
  return new AwsIntegrationError(code, context ? `${context}: ${message}` : message, name);
}
