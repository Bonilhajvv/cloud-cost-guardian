import { Role } from '../enums';

export interface RequestUser {
  userId: string;
  email: string;
  role: Role;
  organizationId: string | null;
}

export interface TenantUser extends RequestUser {
  organizationId: string;
}

