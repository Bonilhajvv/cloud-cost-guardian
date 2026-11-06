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
import { AwsAccount } from '../../aws-accounts/entities/aws-account.entity';
import { KubernetesClusterStatus, KubernetesProvider } from '../../common/enums';
import { Organization } from '../../organizations/entities/organization.entity';

@Entity('kubernetes_clusters')
@Index(['organizationId', 'name'], { unique: true })
export class KubernetesCluster {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'uuid', nullable: true })
  awsAccountId: string | null;

  @ManyToOne(() => AwsAccount, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'awsAccountId' })
  awsAccount: AwsAccount | null;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'enum', enum: KubernetesProvider, default: KubernetesProvider.UNKNOWN })
  provider: KubernetesProvider;

  @Index()
  @Column({ type: 'enum', enum: KubernetesClusterStatus, default: KubernetesClusterStatus.PENDING })
  status: KubernetesClusterStatus;

  @Index({ unique: true, where: '"installTokenHash" IS NOT NULL' })
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  installTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  installTokenExpiresAt: Date | null;

  @Column({ type: 'int', default: 1 })
  agentTokenVersion: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  installMethod: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  agentVersion: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  kubernetesVersion: string | null;

  @Column({ default: false })
  metricsServerAvailable: boolean;

  @Column({ type: 'int', default: 0 })
  nodeCount: number;

  @Column({ type: 'int', default: 0 })
  podCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  connectedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
