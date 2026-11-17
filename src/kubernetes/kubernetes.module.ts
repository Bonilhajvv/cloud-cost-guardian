import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsAccountsModule } from '../aws-accounts/aws-accounts.module';
import { ResourceInventoryModule } from '../resource-inventory/resource-inventory.module';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { KubernetesContainerUsageDaily } from './entities/kubernetes-container-usage-daily.entity';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesUsageSample } from './entities/kubernetes-usage-sample.entity';
import { KubernetesWorkload } from './entities/kubernetes-workload.entity';
import { KubernetesWorkloadUsageDaily } from './entities/kubernetes-workload-usage-daily.entity';
import { AgentTokenGuard } from './guards/agent-token.guard';
import { KubernetesAgentController } from './kubernetes-agent.controller';
import { KubernetesClustersController } from './kubernetes-clusters.controller';
import { KubernetesClustersService } from './kubernetes-clusters.service';
import { KubernetesIngestService } from './kubernetes-ingest.service';
import { KubernetesInstallController } from './kubernetes-install.controller';
import { KubernetesAnalyzerService } from './kubernetes-analyzer.service';
import { KubernetesMetricsService } from './kubernetes-metrics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KubernetesCluster, KubernetesNode, KubernetesWorkload, KubernetesUsageSample, KubernetesWorkloadUsageDaily, KubernetesContainerUsageDaily]),
    AwsAccountsModule,
    ResourceInventoryModule,
  ],
  controllers: [KubernetesClustersController, KubernetesInstallController, KubernetesAgentController],
  providers: [KubernetesClustersService, KubernetesIngestService, KubernetesMetricsService, KubernetesAnalyzerService, AgentTokenGuard],
  exports: [KubernetesMetricsService, KubernetesClustersService, KubernetesAnalyzerService],
})
export class KubernetesModule {}
