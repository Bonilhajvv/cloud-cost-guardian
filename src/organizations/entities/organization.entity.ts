import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrganizationStatus } from '../../common/enums';
import { OrganizationUser } from './organization-user.entity';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 160 })
  name: string;

  @Index({ unique: true })
  @Column({ length: 80 })
  slug: string;

  @Index()
  @Column({ type: 'enum', enum: OrganizationStatus, default: OrganizationStatus.ACTIVE })
  status: OrganizationStatus;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @OneToMany(() => OrganizationUser, (m) => m.organization)
  members: OrganizationUser[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
