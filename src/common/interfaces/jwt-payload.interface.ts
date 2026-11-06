import { Role } from '../enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  org: string | null;
  typ: 'access' | 'refresh';
}
