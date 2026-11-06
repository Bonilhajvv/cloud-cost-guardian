import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AwsAccount } from '../../aws-accounts/entities/aws-account.entity';
import { CostGranularity, CostKind } from '../../common/enums';
import { numericTransformer } from '../../common/helpers/numeric.transformer';

@Entity('cost_snapshots')
@Index(['organizationId', 'granularity', 'periodStart'])
@Index(['awsAccountId', 'granularity', 'kind', 'periodStart'])
export class CostSnapshot {
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

  @Column({ type: 'varchar', length: 128, nullable: true })
  service: string | null;

  @Index()
  @Column({ type: 'varchar', length: 512, nullable: true })
  resourceId: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 4, transformer: numericTransformer })
  amount: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'enum', enum: CostGranularity })
  granularity: CostGranularity;

  @Column({ type: 'enum', enum: CostKind, default: CostKind.ACTUAL })
  kind: CostKind;

  @Column({ type: 'date' })
  periodStart: string;

  @Column({ type: 'date' })
  periodEnd: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
