import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/helpers/numeric.transformer';
import { KubernetesCluster } from './kubernetes-cluster.entity';

const cores = { type: 'numeric' as const, precision: 10, scale: 3, nullable: true, transformer: numericTransformer };
const bytes = { type: 'bigint' as const, nullable: true, transformer: numericTransformer };

@Entity('kubernetes_workloads')
@Index(['clusterId', 'namespace', 'kind', 'name'], { unique: true })
export class KubernetesWorkload {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
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

  @Column({ type: 'int', nullable: true })
  desiredReplicas: number | null;

  @Column({ type: 'int', default: 0 })
  podCount: number;

  @Column({ ...cores })
  requestsCpu: number | null;

  @Column({ ...bytes })
  requestsMemoryBytes: number | null;

  @Column({ ...cores })
  limitsCpu: number | null;

  @Column({ ...bytes })
  limitsMemoryBytes: number | null;

  @Column({ ...cores })
  usageCpu: number | null;

  @Column({ ...bytes })
  usageMemoryBytes: number | null;

  @Column({ type: 'jsonb', nullable: true })
  hpa: { minReplicas: number | null; maxReplicas: number } | null;

  @Index()
  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;
}
