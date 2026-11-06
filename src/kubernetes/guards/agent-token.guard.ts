import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AgentPrincipal } from '../interfaces/kubernetes.interface';
import { KubernetesClustersService } from '../kubernetes-clusters.service';

@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(private readonly clusters: KubernetesClustersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { agent?: AgentPrincipal }>();
    const header = request.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const agent = token ? await this.clusters.verifyAgentToken(token) : null;
    if (!agent) throw new UnauthorizedException('Invalid or revoked agent token');
    request.agent = agent;
    return true;
  }
}
