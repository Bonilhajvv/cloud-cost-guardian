import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsEksModule } from '../aws/eks/aws-eks.module';
import { AwsAccountsModule } from '../aws-accounts/aws-accounts.module';
import { ResourceInventoryModule } from '../resource-inventory/resource-inventory.module';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { KubernetesContainerUsageDaily } from './entities/kubernetes-container-usage-daily.entity';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesRouteHopUsageHourly } from './entities/kubernetes-route-hop-usage-hourly.entity';
import { KubernetesRouteUsageHourly } from './entities/kubernetes-route-usage-hourly.entity';
import { KubernetesUsageSample } from './entities/kubernetes-usage-sample.entity';
import { KubernetesWorkload } from './entities/kubernetes-workload.entity';
import { KubernetesWorkloadUsageDaily } from './entities/kubernetes-workload-usage-daily.entity';
import { AgentTokenGuard } from './guards/agent-token.guard';
import { EksConnectionsService } from './eks-connections.service';
import { KubernetesAgentController } from './kubernetes-agent.controller';
import { KubernetesClustersController } from './kubernetes-clusters.controller';
import { KubernetesClustersService } from './kubernetes-clusters.service';
import { KubernetesIngestService } from './kubernetes-ingest.service';
import { KubernetesInstallController } from './kubernetes-install.controller';
import { KubernetesAnalyzerService } from './kubernetes-analyzer.service';
import { KubernetesMetricsService } from './kubernetes-metrics.service';
import { KubernetesRequestCostsService } from './kubernetes-request-costs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KubernetesCluster, KubernetesNode, KubernetesWorkload, KubernetesUsageSample, KubernetesWorkloadUsageDaily, KubernetesContainerUsageDaily, KubernetesRouteUsageHourly, KubernetesRouteHopUsageHourly]),
    AwsAccountsModule,
    ResourceInventoryModule,
    AwsEksModule,
  ],
  controllers: [KubernetesClustersController, KubernetesInstallController, KubernetesAgentController],
  providers: [KubernetesClustersService, KubernetesIngestService, KubernetesMetricsService, KubernetesAnalyzerService, AgentTokenGuard, EksConnectionsService, KubernetesRequestCostsService],
  exports: [KubernetesMetricsService, KubernetesClustersService, KubernetesAnalyzerService, EksConnectionsService],
})
export class KubernetesModule {}
