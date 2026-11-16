# Cloud Cost Guardian — API

SaaS multi-tenant de redução de custos AWS. Monólito modular NestJS, read-only na AWS, pronto para Kubernetes e para extração futura de microsserviços.

Stack: Node 20+/22, NestJS 11, TypeScript 5.9, PostgreSQL 16, TypeORM 0.3, AWS SDK v3, JWT, Swagger, Docker, `@nestjs/schedule`.

> Nest 12 é ESM-only e quebra Jest/ts-jest. Fixado no Nest 11 (CJS) até o ecossistema de testes acompanhar.

## Princípio arquitetural

| Camada | Pergunta | Onde |
|---|---|---|
| Resource Explorer | O que existe? | `src/aws/resources` |
| EC2 / EBS / RDS API | O que é esse recurso? | `src/aws/ec2`, `src/aws/ebs`, `src/aws/rds` |
| CloudWatch | Quanto usa? | `src/aws/metrics` |
| Cost Explorer | Quanto custa? | `src/aws/costs` + snapshots em `src/cost-reports` |
| Compute Optimizer | A AWS recomenda algo? | `src/aws/optimizer` |
| Pricing API | Quanto custaria on-demand? | `src/aws/pricing` (identidade da plataforma, cache 24h) |
| Analyzers | O que mostrar ao usuário? | `ec2-analyzer`, `ebs-analyzer`, `rds-analyzer` (puros, sem I/O) |

Fluxo do scan (`src/scans/scan-orchestrator.service.ts`; o RDS fica em `src/scans/rds-scan.service.ts`):

```
RESOURCES  Resource Explorer (fallback: DescribeRegions + DescribeInstances) → AwsResource
           → DescribeInstances/DescribeInstanceTypes → CloudWatch → metadata.ec2/metrics
           → DescribeVolumes → CloudWatch EBS → preços por GB, IOPS e throughput
           → DescribeDBInstances → CloudWatch RDS → ciclo de vida da engine → preços RDS
COSTS      GetCostAndUsage (mensal/diário por serviço) + WithResources (14d EC2) + Forecast → CostSnapshot
OPTIMIZER  GetEC2InstanceRecommendations e GetRDSDatabaseRecommendations por região
ANALYSIS   Postgres → analyzers de EBS, EC2 e RDS → metadata.analysis + Recommendation
```

Cada etapa grava no Postgres. O analyzer só lê o banco, então reprocessar não custa chamadas AWS. O frontend nunca dispara chamada AWS.

## Convenção de pastas (por módulo)

```
<modulo>/
  <modulo>.module.ts / .controller.ts / .service.ts
  dto/          classes de entrada/saída HTTP (class-validator)
  entities/     entidades TypeORM
  interfaces/   interfaces e types internos normalizados
  helpers/      funções puras
  constants/    constantes
```

Guards globais em `src/common/guards`: `JwtAuthGuard` → `RolesGuard` → `TenantGuard`. Sem comentários no código, por convenção do projeto.

## Multi-tenancy e RBAC

- O tenant vem sempre do JWT (`org`), nunca de body ou URL. A cada request, o `JwtStrategy` revalida no banco o usuário ativo, a membership e se a org está `ACTIVE`; org suspensa derruba tokens já emitidos.
- `TenantGuard` exige contexto de org e bloqueia `organizationId` divergente em params/query.
- Todo service filtra por `organizationId`; recurso de outro tenant responde 404.
- `SUPER_ADMIN` não tem org no token e só acessa `/api/v1/admin/*`.
- Roles: `ORG_ADMIN` escreve; `ORG_MEMBER` e `VIEWER` só leem.

## Integração AWS

1. `POST /aws-accounts` gera um `externalId` aleatório. Nenhuma chave de cliente é armazenada.
2. `GET /aws-accounts/:id/setup` devolve a trust policy (com `sts:ExternalId`) e a policy read-only de menor privilégio.
3. O cliente cria a role e faz `PATCH /aws-accounts/:id { roleArn }`.
4. `POST /aws-accounts/:id/test-connection` roda AssumeRole + GetCallerIdentity, valida o account id e avisa se a trust policy não exige ExternalId.
5. `POST /aws-accounts/:id/scan` dispara o scan completo (202, assíncrono).

A policy read-only inclui `rds:DescribeDBInstances`, `rds:DescribeDBMajorEngineVersions` e `compute-optimizer:GetRDSDatabaseRecommendations`. Contas conectadas antes do módulo de RDS precisam atualizar a stack. Até lá, o scan registra um aviso e segue sem RDS, sem falhar.

A identidade da plataforma vem da default credential chain (IRSA/Pod Identity no EKS) e precisa de `sts:AssumeRole` e `pricing:GetProducts`. O cliente não precisa de permissão de Pricing. As credenciais temporárias ficam só em memória, com refresh 5 min antes de expirar e deduplicação de AssumeRole concorrente. `AwsClientFactory.createClient(EC2Client, account, region)` funciona para qualquer client v3, com retry `adaptive` para throttling. Falha numa região não aborta as demais.

## Conectar a AWS em um clique (CloudFormation)

`GET /aws-accounts/:id/setup` devolve `cloudFormation.quickCreateUrl`. O link abre o console da AWS com o template e o ExternalId preenchidos: o cliente marca o aceite de IAM (`CAPABILITY_NAMED_IAM`) e clica em "Create stack". O `roleArn` esperado já vem salvo na conta, então o frontend só precisa repetir `POST /aws-accounts/:id/test-connection` até dar sucesso.

Para o link existir, publique o template num S3 público e configure `CFN_TEMPLATE_URL`:

```bash
curl -s http://localhost:3000/api/v1/public/cloudformation/readonly-role.json > readonly-role.json
aws s3 cp readonly-role.json s3://SEU-BUCKET-PUBLICO/cloudformation/readonly-role.json --acl public-read
```

## Kubernetes

Um agente read-only roda no cluster do cliente e só faz HTTPS de saída. Funciona em EKS, self-managed (kubeadm/k3s), GKE e AKS.

```
POST /kubernetes-clusters { name }      →  commands.kubectl | commands.helm (link válido por 24h)
kubectl apply -f "<link>.yaml"          →  agente envia relatório a cada 5 min
GET  /kubernetes-clusters/:id           →  status CONNECTED, nós, pods, versão, metrics-server
```

- **Tokens:** o link de instalação é de uso único e expira em 24h; morre na primeira conexão. O token do agente é um HMAC (`AGENT_TOKEN_SECRET`) ligado ao cluster e a uma versão. `DELETE /kubernetes-clusters/:id` revoga o token na hora; `POST /:id/install` gera um link novo.
- **RBAC:** só `get`, `list` e `watch` em nodes, pods, workloads, HPA e `metrics.k8s.io`, mais `get` em `nodes/stats`. Não lê secrets nem configmaps, e só repassa labels de topologia e instância.
- **Disco do nó:** a partir da 0.2.0, o agente lê o uso do filesystem de cada nó no kubelet (`https://<IP do nó>:10250/stats/summary`, permissão `nodes/stats`, certificado do kubelet não verificado, como no metrics-server com `--kubelet-insecure-tls`). Esse dado alimenta a recomendação de aumentar disco quando a EC2 não tem CloudWatch Agent. Uma NetworkPolicy que bloqueie a porta 10250 desliga só essa leitura.
- **Correlação:** o `spec.providerID` (`aws:///…/i-…`) liga o nó à EC2. A memória real do nó entra na análise como fonte `KUBERNETES_AGENT`, e o P95 usa o maior valor entre uso real e requests dos pods. Assim o veredito das opções sai `FITS` ou `DOES_NOT_FIT` em vez de `UNKNOWN`.
- **Descoberta:** `GET /kubernetes-clusters/suggestions` lista clusters detectados nas EC2 que ainda não foram conectados.
- **Saúde:** um cluster sem relatório por 15 min vira `STALE` (job a cada 5 min). Amostras com mais de 30 dias são apagadas diariamente.

Código do agente em `agents/k8s-agent` (Go, só biblioteca padrão, imagem distroless de cerca de 11 MB) e Helm chart em `agents/k8s-agent/chart`.

```bash
cd agents/k8s-agent && go test ./...
docker build -t ghcr.io/your-org/ccg-k8s-agent:0.2.0 agents/k8s-agent
helm package agents/k8s-agent/chart && helm push ccg-k8s-agent-0.2.0.tgz oci://ghcr.io/your-org/charts
```

Para rodar localmente contra qualquer cluster, sem imagem: `kubectl proxy --port 8001`, depois `K8S_API_URL=http://127.0.0.1:8001 CCG_API_URL=... CCG_AGENT_TOKEN=... go run .`. Nesse modo, o disco do nó é lido pelo proxy do API server com a sua credencial, porque a máquina local não alcança a porta do kubelet.

## Regras do analyzer EC2

Fonte de custo, nesta ordem: Cost Explorer por recurso → derivado do Compute Optimizer → preço on-demand (Pricing API) → indisponível (economia `null`).

Nós Kubernetes são detectados por tags (`kubernetes.io/cluster/*`, `eks:cluster-name`, `eks:nodegroup-name`, `karpenter.sh/*`, `k8s.io/role/master`) e pelo nome. Para eles:
- nunca é sugerido tipo com menos de 2 GiB (control plane e worker);
- reduzir memória sem métricas de memória dá risco `HIGH`;
- a recomendação manda aplicar via node group ou launch template, drenando o nó antes.

Trocar só a RAM: nas famílias `c`, `m` e `r`, o mesmo tamanho tem a mesma vCPU e 2, 4 ou 8 GiB por vCPU. Quando só a memória não cabe e a CPU P95 fica abaixo de 60%, o upsize vai para a família `r` do mesmo tamanho (ex.: `m6i.large` → `r6i.large`) em vez de dobrar o tamanho. Quando o downsize normal não serve, mas a memória projetada na família `c` fica abaixo de 75%, sai um rightsizing para `c` (ex.: `m6i.large` → `c6i.large`). Na família `t` isso não se aplica: de `micro` a `large` a vCPU é sempre 2, então o tamanho já muda só a RAM.

## Regras do analyzer EBS

- `EBS_UNUSED`: volume `available`. Recomenda snapshot e remoção.
- `gp2` → `gp3`: só quando o pico de IOPS e throughput cabe no baseline do `gp3` (3000 IOPS / 125 MB/s).
- `EBS_EXPAND`: disco com P95 de uso ≥ 85% ganha um tamanho que leva o uso para cerca de 70%, com o custo extra, os passos (`ModifyVolume`, `growpart`, `resize2fs`/`xfs_growfs`) e o aviso de que volume não diminui. Só vale para instância com um único volume EBS, porque com vários não dá para saber qual está cheio. O uso vem do CloudWatch Agent ou, na falta dele, do agente Kubernetes.
- `gp3` com IOPS/throughput provisionados acima do uso: recomenda baixar para o pico × 1,5 (mínimo 3000 / 125).
- `io1`/`io2` → `gp3`: quando o pico × 1,5 cabe nos limites do `gp3` e o volume não é Multi-Attach. Avisa sobre latência e sobre a durabilidade do `io2`.
- O custo do volume inclui IOPS e throughput provisionados quando o preço é conhecido. O pico vem de médias horárias, por isso a redução de desempenho sai com risco `MEDIUM`.

## Regras do analyzer RDS

- `RDS_IDLE`: zero conexões em 14 dias (mínimo de 7 dias de dados) ou ocioso pelo Compute Optimizer. Nunca para banco com réplica. Recomenda snapshot final antes de apagar.
- `RDS_RIGHTSIZING` / `RDS_UPSIZE`: só pelo Compute Optimizer. Não há heurística própria de CPU, porque o banco usa a RAM livre como cache e diminuir a classe é arriscado. Downsize sai com risco mínimo `MEDIUM`; upsize mostra o aumento de custo.
- `RDS_MULTI_AZ`: banco Multi-AZ fora de produção, detectado pela tag `Environment`/`env`/`stage`/`ambiente` (confiança alta) ou pelo nome (`-hml`, `-dev`, `-qa`...). A economia é a diferença entre os preços Multi-AZ e Single-AZ.
- `RDS_EXTENDED_SUPPORT`: versão maior da engine fora do suporte padrão (`DescribeDBMajorEngineVersions`). A economia é o custo do Extended Support: vCPU × preço por vCPU-hora × 730, em dobro no Multi-AZ. 180 dias antes do fim do suporte, a análise ganha um aviso.
- Storage `gp2` → `gp3` não é recomendado no RDS: o preço por GB é o mesmo.
- Aurora e bancos fora do status `available` ainda não são analisados.

## Métricas coletadas (sem instalar nada no cliente)

| Fonte | Métricas | Uso |
|---|---|---|
| `AWS/EC2` | CPU (média, P95, máx), rede | Ociosidade e rightsizing |
| `AWS/EC2` (família T) | `CPUCreditBalance`, `CPUSurplusCreditsCharged` | Bloqueia downsize que esgotaria créditos |
| `AWS/EBS` | IOPS, throughput, `BurstBalance` | gp2 → gp3, volume sem uso |
| `DescribeVolumes` | volumes `available` | `EBS_UNUSED` |
| `CWAgent` (se existir) | `mem_used_percent`, `disk_used_percent` | Memória e disco |
| `ContainerInsights` (se existir) | `node_memory_utilization` | Memória de nós Kubernetes |
| `AWS/RDS` | CPU (média, P95, máx), `DatabaseConnections` | RDS ocioso |
| Agente Kubernetes (se instalado) | memória, requests e disco do nó | Memória de nós e `EBS_EXPAND` |

`GET /dashboard/summary` traz `metricsCoverage`: quantas EC2 têm memória medida, por qual fonte, e a dica de como ativar.

## Rodar local

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run migration:run
npm run seed:super-admin
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs`
- Probes: `/health/live`, `/health/ready`

Stack completa em container: `docker compose up --build` (migrate → api + worker).

```bash
npm test
npm run migration:generate -- src/database/migrations/Nome
```

## Deploy da plataforma no Kubernetes (`k8s/`)

- `ccg-migrate` (Job) roda as migrations; nunca no boot da app.
- `ccg-api` tem 2+ réplicas com HPA e PDB, e `JOBS_ENABLED=false`.
- `ccg-worker` tem 1 réplica (`Recreate`) e `JOBS_ENABLED=true`, rodando os crons.
- Crons e scans manuais usam advisory lock do Postgres por conta, então N pods nunca escaneiam a mesma conta ao mesmo tempo.
- O ServiceAccount usa IRSA (`eks.amazonaws.com/role-arn`), e essa role precisa de `sts:AssumeRole`.
- Secrets em `secret.example.yaml`: troque por External Secrets/Sealed Secrets.

```bash
kubectl apply -f k8s/secret.example.yaml
kubectl apply -k k8s
```

O worker é o primeiro candidato a virar microsserviço: mesma imagem, outro entrypoint. Os módulos só se comunicam por services exportados.

## Jobs

| Job | Cron | Intervalo mínimo |
|---|---|---|
| Resource scan + análise | `0 */6 * * *` | 3h |
| Cost sync + análise | `30 */6 * * *` | 3h |
| Compute Optimizer + análise | `0 3 * * *` | 12h |

## Endpoints principais

`/auth` (register, login, refresh, me) · `/users` · `/organizations/me` · `/aws-accounts` · `/scans/history` · `/resources` · `/resources/ec2/analysis` · `/costs/{summary,daily,trend,by-resource}` · `/recommendations` (+ `PATCH :id/status`) · `/dashboard/summary` · `/audit-logs` · `/admin/*`

## Limitações conhecidas da V1

- Valores em USD (moeda do Cost Explorer). Ainda não há conversão para BRL.
- `realizedMonthlySavings` hoje é informado manualmente via `PATCH status`; a medição automática pós-mudança fica para depois.
- Sem resource-level data no Cost Explorer nem Compute Optimizer, o custo vem do preço on-demand, que ignora RI e Savings Plans. Se a Pricing API não responder, a economia fica `null` (nunca inventada).
- Memória só existe com CloudWatch Agent (`mem_used_percent`, Linux), Container Insights ou o agente Kubernetes. Sem eles: `Memory metrics unavailable` e risco elevado quando a RAM diminui.
- Sem rate limit no login ainda (sugestão: `@nestjs/throttler`).
- RDS não cobre Aurora, storage nem backup no custo. S3, Lambda e Savings Plans ficam para as próximas fases.
- Aumentar disco, desligar Multi-AZ e atualizar a engine não são detectados como "implementados": a recomendação só deixa de aparecer no scan seguinte, sem registrar a economia realizada.
- Kubernetes: recomendações por workload (requests muito acima do uso) e bin-packing de nós ainda não viram `Recommendation`; os dados já são coletados.
- Modo EKS sem agente (access entry + IAM) ainda não existe.
