import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { ClusterInstallDto } from './dto/cluster-install.dto';
import { CreateClusterDto } from './dto/create-cluster.dto';
import { KubernetesClustersService } from './kubernetes-clusters.service';

@ApiTags('Kubernetes')
@ApiBearerAuth()
@Controller('kubernetes-clusters')
export class KubernetesClustersController {
  constructor(private readonly clusters: KubernetesClustersService) {}

  @Post()
  @Roles(Role.ORG_ADMIN)
  @ApiOkResponse({ type: ClusterInstallDto })
  create(@CurrentUser() user: TenantUser, @Body() dto: CreateClusterDto) {
    return this.clusters.create(user, dto);
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
