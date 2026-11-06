import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AwsAccountStatus } from '../../common/enums';
import { Organization } from '../../organizations/entities/organization.entity';

@Entity('aws_accounts')
@Index(['organizationId', 'awsAccountId'], { unique: true })
export class AwsAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ length: 12 })
  awsAccountId: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  roleArn: string | null;

  @Column({ length: 64 })
  externalId: string;

  @Column({ length: 32 })
  defaultRegion: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  regions: string[];

  @Index()
  @Column({ type: 'enum', enum: AwsAccountStatus, default: AwsAccountStatus.PENDING })
  status: AwsAccountStatus;

  @Column({ type: 'timestamptz', nullable: true })
  lastScanAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastCostSyncAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastOptimizerSyncAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastErrorAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
