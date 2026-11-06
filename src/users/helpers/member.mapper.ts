import { OrganizationUser } from '../../organizations/entities/organization-user.entity';
import { MemberDto } from '../dto/member.dto';

export function toMemberDto(m: OrganizationUser): MemberDto {
  return {
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    joinedAt: m.createdAt,
  };
}
