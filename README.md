# Cloud Cost Guardian — API

SaaS multi-tenant de redução de custos AWS. Monólito modular NestJS, read-only na AWS, pronto para Kubernetes e para extração futura de microsserviços.

Stack: Node 20+/22, NestJS 11, TypeScript 5.9, PostgreSQL 16, TypeORM 0.3, AWS SDK v3, JWT, Swagger, Docker, `@nestjs/schedule`.

> Nest 12 é ESM-only e quebra Jest/ts-jest. Fixado no Nest 11 (CJS) até o ecossistema de testes acompanhar.

## Princípio arquitetural

| Camada | Pergunta | Onde |
|---|---|---|
| Resource Explorer | O que existe? | `src/aws/resources` |
| EC2 API | O que é esse recurso? | `src/aws/ec2/ec2.service.ts` |
| CloudWatch | Quanto usa? | `src/aws/metrics` |
| Cost Explorer | Quanto custa? | `src/aws/costs` + snapshots em `src/cost-reports` |
| Compute Optimizer | A AWS recomenda algo? | `src/aws/optimizer` |
| Pricing API | Quanto custaria on-demand? | `src/aws/pricing` (identidade da plataforma, cache 24h) |
| Analyzer | O que mostrar ao usuário? | `src/aws/ec2/ec2-analyzer.service.ts` (puro, sem I/O) |

Fluxo EC2 (`src/scans/scan-orchestrator.service.ts`):

```
RESOURCES  Resource Explorer (fallback: DescribeRegions + DescribeInstances) → AwsResource
           → DescribeInstances/DescribeInstanceTypes → CloudWatch → metadata.ec2/metrics
COSTS      GetCostAndUsage (mensal/diário por serviço) + WithResources (14d EC2) + Forecast → CostSnapshot
OPTIMIZER  GetEC2InstanceRecommendations por região → metadata.computeOptimizer
ANALYSIS   Postgres → Ec2Analyzer → metadata.analysis + Recommendation
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
- **RBAC:** só `get`, `list` e `watch` em nodes, pods, workloads, HPA e `metrics.k8s.io`. Não lê secrets nem configmaps, e só repassa labels de topologia e instância.
- **Correlação:** o `spec.providerID` (`aws:///…/i-…`) liga o nó à EC2. A memória real do nó entra na análise como fonte `KUBERNETES_AGENT`, e o P95 usa o maior valor entre uso real e requests dos pods. Assim o veredito das opções sai `FITS` ou `DOES_NOT_FIT` em vez de `UNKNOWN`.
- **Descoberta:** `GET /kubernetes-clusters/suggestions` lista clusters detectados nas EC2 que ainda não foram conectados.
- **Saúde:** um cluster sem relatório por 15 min vira `STALE` (job a cada 5 min). Amostras com mais de 30 dias são apagadas diariamente.

Código do agente em `agents/k8s-agent` (Go, só biblioteca padrão, imagem distroless de cerca de 11 MB) e Helm chart em `agents/k8s-agent/chart`.

```bash
cd agents/k8s-agent && go test ./...
docker build -t ghcr.io/your-org/ccg-k8s-agent:0.1.0 agents/k8s-agent
helm package agents/k8s-agent/chart && helm push ccg-k8s-agent-0.1.0.tgz oci://ghcr.io/your-org/charts
```

Para rodar localmente contra qualquer cluster, sem imagem: `kubectl proxy --port 8001`, depois `K8S_API_URL=http://127.0.0.1:8001 CCG_API_URL=... CCG_AGENT_TOKEN=... go run .`

## Regras do analyzer EC2

Fonte de custo, nesta ordem: Cost Explorer por recurso → derivado do Compute Optimizer → preço on-demand (Pricing API) → indisponível (economia `null`).

Nós Kubernetes são detectados por tags (`kubernetes.io/cluster/*`, `eks:cluster-name`, `eks:nodegroup-name`, `karpenter.sh/*`, `k8s.io/role/master`) e pelo nome. Para eles:
- nunca é sugerido tipo com menos de 2 GiB (control plane e worker);
- reduzir memória sem métricas de memória dá risco `HIGH`;
- a recomendação manda aplicar via node group ou launch template, drenando o nó antes.

## Métricas coletadas (sem instalar nada no cliente)

| Fonte | Métricas | Uso |
|---|---|---|
| `AWS/EC2` | CPU (média, P95, máx), rede | Ociosidade e rightsizing |
| `AWS/EC2` (família T) | `CPUCreditBalance`, `CPUSurplusCreditsCharged` | Bloqueia downsize que esgotaria créditos |
| `AWS/EBS` | IOPS, throughput, `BurstBalance` | gp2 → gp3, volume sem uso |
| `DescribeVolumes` | volumes `available` | `EBS_UNUSED` |
| `CWAgent` (se existir) | `mem_used_percent`, `disk_used_percent` | Memória e disco |
| `ContainerInsights` (se existir) | `node_memory_utilization` | Memória de nós Kubernetes |

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
- Memória só existe com CloudWatch Agent (`mem_used_percent`, Linux). Sem ele: `Memory metrics unavailable` e risco elevado quando a RAM diminui.
- Sem rate limit no login ainda (sugestão: `@nestjs/throttler`).
- EBS cobre volume solto e gp2 → gp3; io1/io2 superprovisionado ainda não. RDS, S3 e Lambda ficam para as próximas fases.
- Kubernetes: recomendações por workload (requests muito acima do uso) e bin-packing de nós ainda não viram `Recommendation`; os dados já são coletados.
- Modo EKS sem agente (access entry + IAM) ainda não existe.
