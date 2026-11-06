import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/helpers/numeric.transformer';

@Entity('kubernetes_usage_samples')
@Index(['clusterId', 'nodeName', 'sampledAt'])
@Index(['sampledAt'])
export class KubernetesUsageSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  clusterId: string;

  @Column({ length: 253 })
  nodeName: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  instanceId: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true, transformer: numericTransformer })
  cpuCores: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: numericTransformer })
  memoryBytes: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: numericTransformer })
  requestsMemoryBytes: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: numericTransformer })
  allocatableMemoryBytes: number | null;

  @Column({ type: 'timestamptz' })
  sampledAt: Date;
}
