import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums';
import { OrganizationUser } from '../../organizations/entities/organization-user.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 254 })
  email: string;

  @Column({ length: 120 })
  name: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: [Role.SUPER_ADMIN], enumName: 'platform_role', nullable: true })
  platformRole: Role.SUPER_ADMIN | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @OneToMany(() => OrganizationUser, (m) => m.user)
  memberships: OrganizationUser[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
