import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { ClusterInstallDto } from './dto/cluster-install.dto';
import { CreateClusterDto } from './dto/create-cluster.dto';
import { CreateEksConnectionDto, EksCollectResultDto, EksConnectionDto } from './dto/eks-connection.dto';
import { EksConnectionsService } from './eks-connections.service';
import { ListNamespacesDto } from './dto/list-namespaces.dto';
import { SetClusterEnvironmentDto, SetNamespaceEnvironmentsDto } from './dto/set-cluster-environment.dto';
import { KubernetesClustersService } from './kubernetes-clusters.service';

@ApiTags('Kubernetes')
@ApiBearerAuth()
@Controller('kubernetes-clusters')
export class KubernetesClustersController {
  constructor(
    private readonly clusters: KubernetesClustersService,
    private readonly eksConnections: EksConnectionsService,
  ) {}

  @Post()
  @Roles(Role.ORG_ADMIN)
  @ApiOkResponse({ type: ClusterInstallDto })
  create(@CurrentUser() user: TenantUser, @Body() dto: CreateClusterDto) {
    return this.clusters.create(user, dto);
  }

  @Post('eks')
  @Roles(Role.ORG_ADMIN)
  @ApiOkResponse({ type: EksConnectionDto })
  connectEks(@CurrentUser() user: TenantUser, @Body() dto: CreateEksConnectionDto) {
    return this.eksConnections.create(user, dto);
  }

  @Post(':id/test-connection')
  @HttpCode(200)
  @Roles(Role.ORG_ADMIN)
  @ApiOkResponse({ type: EksCollectResultDto })
  testConnection(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.eksConnections.testConnection(user, id);
  }

  @Get()
  @Roles(...ORG_READ_ROLES)
  list(@CurrentUser() user: TenantUser) {
    return this.clusters.list(user.organizationId);
  }

  @Get('suggestions')
  @Roles(...ORG_READ_ROLES)
  suggestions(@CurrentUser() user: TenantUser) {
    return this.clusters.suggestions(user.organizationId);
  }

  @Get(':id')
  @Roles(...ORG_READ_ROLES)
  get(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clusters.get(user.organizationId, id);
  }

  @Get(':id/nodes')
  @Roles(...ORG_READ_ROLES)
  nodes(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clusters.listNodes(user.organizationId, id);
  }

  @Get(':id/workloads')
  @Roles(...ORG_READ_ROLES)
  workloads(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.clusters.listWorkloads(user.organizationId, id, query);
  }

  @Get(':id/namespaces')
  @Roles(...ORG_READ_ROLES)
  namespaces(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: ListNamespacesDto) {
    return this.clusters.listNamespaces(user.organizationId, id, query);
  }

  @Patch(':id/environment')
  @Roles(Role.ORG_ADMIN)
  setEnvironment(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetClusterEnvironmentDto) {
    return this.clusters.setEnvironment(user, id, dto.environment);
  }

  @Patch(':id/namespaces/environment')
  @Roles(Role.ORG_ADMIN)
  setNamespaceEnvironments(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetNamespaceEnvironmentsDto) {
    return this.clusters.setNamespaceEnvironments(user, id, dto.items);
  }

  @Post(':id/install')
  @Roles(Role.ORG_ADMIN)
  @ApiOkResponse({ type: ClusterInstallDto })
  install(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clusters.regenerateInstall(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.ORG_ADMIN)
  revoke(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clusters.revoke(user, id);
  }
}
