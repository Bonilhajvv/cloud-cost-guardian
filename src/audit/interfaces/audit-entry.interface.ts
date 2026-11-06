import { AuditAction } from '../../common/enums';

export interface AuditEntry {
  action: AuditAction;
  organizationId?: string | null;
  userId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}
