export type MaxConnectionsSetting = { source: 'DEFAULT' } | { source: 'PARAMETER_GROUP'; value: string } | { source: 'UNREADABLE' };

export interface ConnectionLimit {
  limit: number;
  fixed: boolean;
  assumed: boolean;
}
