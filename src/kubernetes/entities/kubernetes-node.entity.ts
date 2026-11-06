import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/helpers/numeric.transformer';
import { KubernetesCluster } from './kubernetes-cluster.entity';

const cores = { type: 'numeric' as const, precision: 10, scale: 3, nullable: true, transformer: numericTransformer };
const bytes = { type: 'bigint' as const, nullable: true, transformer: numericTransformer };

@Entity('kubernetes_nodes')
@Index(['clusterId', 'nodeName'], { unique: true })
export class KubernetesNode {
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
  nodeName: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  providerId: string | null;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  instanceId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  instanceType: string | null;

  @Column({ length: 32 })
  role: string;

  @Column({ ...cores })
  capacityCpu: number | null;

  @Column({ ...bytes })
  capacityMemoryBytes: number | null;

  @Column({ ...cores })
  allocatableCpu: number | null;

  @Column({ ...bytes })
  allocatableMemoryBytes: number | null;

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

  @Column({ type: 'int', default: 0 })
  podCount: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  labels: Record<string, string>;

  @Index()
  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;
}
