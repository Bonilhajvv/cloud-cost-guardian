import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationStatus, Role } from '../common/enums';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { OrganizationUser } from '../organizations/entities/organization-user.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class PrincipalService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OrganizationUser) private readonly members: Repository<OrganizationUser>,
  ) {}

  async resolve(userId: string, organizationId: string | null): Promise<RequestUser | null> {
    if (organizationId === null) {
      const user = await this.users.findOneBy({ id: userId, isActive: true });
      if (!user || user.platformRole !== Role.SUPER_ADMIN) return null;
      return { userId: user.id, email: user.email, role: Role.SUPER_ADMIN, organizationId: null };
    }

    const membership = await this.members.findOne({
      where: { userId, organizationId },
      relations: { user: true, organization: true },
    });
    if (!membership?.user.isActive) return null;
    if (membership.organization.status !== OrganizationStatus.ACTIVE) return null;
    return {
      userId: membership.userId,
      email: membership.user.email,
      role: membership.role,
      organizationId: membership.organizationId,
    };
  }

  async defaultOrganizationId(userId: string): Promise<string | null> {
    const membership = await this.members.findOne({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return membership?.organizationId ?? null;
  }
}
