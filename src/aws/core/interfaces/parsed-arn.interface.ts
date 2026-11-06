export interface ParsedArn {
  partition: string;
  service: string;
  region: string;
  accountId: string;
  resource: string;
  resourceId: string;
}
