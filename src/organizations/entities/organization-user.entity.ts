import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../../common/enums';
import { User } from '../../users/entities/user.entity';
import { Organization } from './organization.entity';

@Entity('organization_users')
@Index(['organizationId', 'userId'], { unique: true })
export class OrganizationUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  organizationId: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({
    type: 'enum',
    enum: [Role.ORG_ADMIN, Role.ORG_MEMBER, Role.VIEWER],
    enumName: 'organization_role',
  })
  role: Role;

  @ManyToOne(() => Organization, (o) => o.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @ManyToOne(() => User, (u) => u.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
