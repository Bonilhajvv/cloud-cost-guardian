import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AgentPrincipal } from '../interfaces/kubernetes.interface';

export const CurrentAgent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AgentPrincipal =>
    ctx.switchToHttp().getRequest<{ agent: AgentPrincipal }>().agent,
);
