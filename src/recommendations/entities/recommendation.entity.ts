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
import {
  Level,
  RecommendationSource,
  RecommendationStatus,
  RecommendationType,
} from '../../common/enums';
import { numericTransformer } from '../../common/helpers/numeric.transformer';
import { RecommendationMetadata } from '../interfaces/recommendation-metadata.interface';

const money = { type: 'numeric' as const, precision: 14, scale: 2, transformer: numericTransformer };

@Entity('recommendations')
@Index(['organizationId', 'status'])
@Index(['organizationId', 'type'])
@Index(['awsAccountId', 'resourceId', 'type'])
export class Recommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  awsAccountId: string;

  @ManyToOne(() => AwsAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'awsAccountId' })
  awsAccount: AwsAccount;

  @Column({ length: 512 })
  resourceId: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  resourceArn: string | null;

  @Column({ length: 64 })
  service: string;

  @Column({ type: 'enum', enum: RecommendationType })
  type: RecommendationType;

  @Column({ type: 'enum', enum: RecommendationSource })
  source: RecommendationSource;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: Level, enumName: 'level' })
  severity: Level;

  @Column({ type: 'enum', enum: Level, enumName: 'level' })
  risk: Level;

  @Column({ type: 'enum', enum: Level, enumName: 'level' })
  confidence: Level;

  @Column({ ...money, nullable: true })
  currentMonthlyCost: number | null;

  @Column({ ...money, nullable: true })
  recommendedMonthlyCost: number | null;

  @Column({ ...money, nullable: true })
  estimatedMonthlySavings: number | null;

  @Column({ ...money, nullable: true })
  estimatedYearlySavings: number | null;

  @Column({ ...money, nullable: true })
  realizedMonthlySavings: number | null;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Index()
  @Column({ type: 'enum', enum: RecommendationStatus, default: RecommendationStatus.OPEN })
  status: RecommendationStatus;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: RecommendationMetadata;

  @Column({ type: 'uuid', nullable: true })
  statusChangedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  implementedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
