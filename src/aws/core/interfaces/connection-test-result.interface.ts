import { AwsErrorCode } from './aws-error-code.type';

export interface ConnectionTestResult {
  success: boolean;
  callerArn: string | null;
  errorCode: AwsErrorCode | null;
  message: string;
  warnings: string[];
}
