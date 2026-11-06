import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AwsAccount } from '../../aws-accounts/entities/aws-account.entity';
import { AwsResourceMetadata } from '../interfaces/aws-resource-metadata.interface';

@Entity('aws_resources')
@Index(['awsAccountId', 'arn'], { unique: true })
@Index(['organizationId', 'service', 'resourceType'])
export class AwsResource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  organizationId: string;

  @Index()
  @Column('uuid')
  awsAccountId: string;

  @ManyToOne(() => AwsAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'awsAccountId' })
  awsAccount: AwsAccount;

  @Column({ length: 2048 })
  arn: string;

  @Index()
  @Column({ length: 512 })
  resourceId: string;

  @Column({ length: 64 })
  service: string;

  @Column({ length: 128 })
  resourceType: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  region: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  name: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: AwsResourceMetadata;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  discoveredAt: Date;

  @Index()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;
}
