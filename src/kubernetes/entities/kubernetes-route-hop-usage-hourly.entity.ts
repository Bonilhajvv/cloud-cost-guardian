import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/helpers/numeric.transformer';
import { KubernetesCluster } from './kubernetes-cluster.entity';

@Entity('kubernetes_route_hop_usage_hourly')
@Index(['clusterId', 'hour', 'entryService', 'entryRoute', 'hopKind', 'namespace', 'workloadKind', 'workloadName', 'service', 'target'], { unique: true })
export class KubernetesRouteHopUsageHourly {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  clusterId: string;

  @ManyToOne(() => KubernetesCluster, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clusterId' })
  cluster: KubernetesCluster;

  @Index()
  @Column({ type: 'timestamptz' })
  hour: Date;

  @Column({ length: 253 })
  entryService: string;

  @Column({ length: 253 })
  entryRoute: string;

  @Column({ length: 16 })
  hopKind: string;

  @Column({ length: 253, default: '' })
  namespace: string;

  @Column({ length: 32, default: '' })
  workloadKind: string;

  @Column({ length: 253, default: '' })
  workloadName: string;

  @Column({ length: 253, default: '' })
  service: string;

  @Column({ length: 253, default: '' })
  target: string;

  @Column({ type: 'bigint', default: 0, transformer: numericTransformer })
  spans: number;

  @Column({ type: 'double precision', default: 0 })
  durationMs: number;
}
