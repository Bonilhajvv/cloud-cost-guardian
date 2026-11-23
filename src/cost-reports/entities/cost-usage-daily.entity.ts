import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AwsAccount } from '../../aws-accounts/entities/aws-account.entity';
import { numericTransformer } from '../../common/helpers/numeric.transformer';

const amount = { type: 'numeric' as const, precision: 18, scale: 8, transformer: numericTransformer };

@Entity('cost_usage_daily')
@Index(['awsAccountId', 'resourceId', 'day'])
@Index(['awsAccountId', 'day'])
export class CostUsageDaily {
  @PrimaryColumn('uuid')
  awsAccountId: string;

  @ManyToOne(() => AwsAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'awsAccountId' })
  awsAccount: AwsAccount;

  @PrimaryColumn({ length: 7 })
  billingPeriod: string;

  @PrimaryColumn({ type: 'date' })
  day: string;

  @PrimaryColumn({ length: 512 })
  resourceId: string;

  @PrimaryColumn({ length: 64 })
  service: string;

  @Column('uuid')
  organizationId: string;

  @Column(amount)
  cost: number;

  @Column(amount)
  hours: number;

  @Column(amount)
  hourlyCost: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;
}
