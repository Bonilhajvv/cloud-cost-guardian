import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { INSTALL_TOKEN_PREFIX } from './constants/kubernetes.constant';
import { KubernetesClustersService } from './kubernetes-clusters.service';

@ApiTags('Kubernetes install')
@Public()
@Controller('install/k8s')
export class KubernetesInstallController {
  constructor(private readonly clusters: KubernetesClustersService) {}

  @Get(':file')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  manifest(@Param('file') file: string) {
    return this.clusters.renderManifest(this.token(file.replace(/\.yaml$/, '')), 'manifest');
  }

  @Get(':token/values.yaml')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  helmValues(@Param('token') token: string) {
    return this.clusters.renderManifest(this.token(token), 'helm-values');
  }

  private token(value: string): string {
    if (!value.startsWith(INSTALL_TOKEN_PREFIX) || value.length > 80) throw new NotFoundException();
    return value;
  }
}
