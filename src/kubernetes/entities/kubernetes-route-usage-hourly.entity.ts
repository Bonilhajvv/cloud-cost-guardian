import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/helpers/numeric.transformer';
import { KubernetesCluster } from './kubernetes-cluster.entity';

@Entity('kubernetes_route_usage_hourly')
@Index(['clusterId', 'hour', 'entryService', 'entryRoute'], { unique: true })
export class KubernetesRouteUsageHourly {
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

  @Column({ type: 'bigint', default: 0, transformer: numericTransformer })
  requests: number;

  @Column({ type: 'double precision', default: 0 })
  durationMs: number;
}
