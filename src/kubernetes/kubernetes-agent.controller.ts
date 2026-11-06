import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { CurrentAgent } from './decorators/current-agent.decorator';
import { AgentReportDto } from './dto/agent-report.dto';
import { AgentTokenGuard } from './guards/agent-token.guard';
import { AgentPrincipal } from './interfaces/kubernetes.interface';
import { KubernetesIngestService } from './kubernetes-ingest.service';

@ApiTags('Kubernetes agent')
@ApiBearerAuth()
@Public()
@UseGuards(AgentTokenGuard)
@Controller('agent/k8s')
export class KubernetesAgentController {
  constructor(private readonly ingest: KubernetesIngestService) {}

  @Post('report')
  @HttpCode(202)
  report(@CurrentAgent() agent: AgentPrincipal, @Body() dto: AgentReportDto) {
    return this.ingest.ingest(agent, dto);
  }
}
