import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/helpers/numeric.transformer';
import { KubernetesCluster } from './kubernetes-cluster.entity';

@Entity('kubernetes_workload_usage_daily')
@Index(['clusterId', 'namespace', 'kind', 'name', 'day'], { unique: true })
export class KubernetesWorkloadUsageDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  clusterId: string;

  @ManyToOne(() => KubernetesCluster, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clusterId' })
  cluster: KubernetesCluster;

  @Column({ length: 253 })
  namespace: string;

  @Column({ length: 32 })
  kind: string;

  @Column({ length: 253 })
  name: string;

  @Index()
  @Column({ type: 'date' })
  day: string;

  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true, transformer: numericTransformer })
  maxCpuPerPod: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: numericTransformer })
  maxMemoryPerPodBytes: number | null;

  @Column({ type: 'int', default: 1 })
  samples: number;
}
