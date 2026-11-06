import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { paginate } from '../common/helpers/paginate.helper';
import { Paginated } from '../common/interfaces/paginated.interface';
import { Role } from '../common/enums';
import { OrganizationUser } from '../organizations/entities/organization-user.entity';
import { AddMemberDto } from './dto/add-member.dto';
import { MemberDto } from './dto/member.dto';
import { User } from './entities/user.entity';
import { hashPassword } from './helpers/password.helper';
import { toMemberDto } from './helpers/member.mapper';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OrganizationUser) private readonly members: Repository<OrganizationUser>,
  ) {}

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  findActiveById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id, isActive: true });
  }

  async create(
    data: { email: string; name: string; password: string; platformRole?: Role.SUPER_ADMIN | null },
    manager: EntityManager = this.users.manager,
  ): Promise<User> {
    const email = data.email.toLowerCase();
    if (await manager.existsBy(User, { email })) throw new ConflictException('Email already registered');
    return manager.save(
      manager.create(User, {
        email,
        name: data.name,
        passwordHash: await hashPassword(data.password),
        platformRole: data.platformRole ?? null,
      }),
    );
  }

  addMembership(
    organizationId: string,
    userId: string,
    role: Role,
    manager: EntityManager = this.members.manager,
  ): Promise<OrganizationUser> {
    return manager.save(manager.create(OrganizationUser, { organizationId, userId, role }));
  }

  async markLogin(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { lastLoginAt: new Date() });
  }

  async listMembers(organizationId: string, query: PaginationQueryDto): Promise<Paginated<MemberDto>> {
    const [rows, total] = await this.members.findAndCount({
      where: { organizationId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(rows.map(toMemberDto), total, query);
  }

  async addMember(organizationId: string, dto: AddMemberDto): Promise<MemberDto> {
    return this.users.manager.transaction(async (manager) => {
      let user = await manager.findOneBy(User, { email: dto.email.toLowerCase() });
      if (!user) {
        if (!dto.password) throw new BadRequestException('password is required for new users');
        user = await this.create({ email: dto.email, name: dto.name, password: dto.password }, manager);
      }
      if (await manager.existsBy(OrganizationUser, { organizationId, userId: user.id })) {
        throw new ConflictException('User is already a member of this organization');
      }
      const membership = await this.addMembership(organizationId, user.id, dto.role, manager);
      membership.user = user;
      return toMemberDto(membership);
    });
  }

  async removeMember(organizationId: string, userId: string, actingUserId: string): Promise<void> {
    if (userId === actingUserId) throw new BadRequestException('You cannot remove yourself');
    const result = await this.members.delete({ organizationId, userId });
    if (!result.affected) throw new NotFoundException('Member not found');
  }
}

