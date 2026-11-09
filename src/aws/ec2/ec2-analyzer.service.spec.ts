import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { MEMORY_UNAVAILABLE } from '../metrics/interfaces/utilization-metrics.interface';
import { Ec2UtilizationMetrics } from '../metrics/interfaces/utilization-metrics.interface';
import { Ec2OptimizerRecommendation } from '../optimizer/interfaces/ec2-optimizer.interface';
import { Ec2AnalyzerService } from './ec2-analyzer.service';
import { downsizeCandidateType, upsizeCandidateType } from './helpers/downsize-candidate.helper';
import { mapPerformanceRisk } from './helpers/risk-level.helper';
import { Ec2AnalyzerInput } from './interfaces/ec2-analysis.interface';
import { Ec2InstanceDetails, InstanceTypeSpec } from './interfaces/ec2-instance.interface';

const M6I_LARGE: InstanceTypeSpec = { instanceType: 'm6i.large', vcpu: 2, memoryGiB: 8, architectures: ['x86_64'] };

function instance(overrides: Partial<Ec2InstanceDetails> = {}): Ec2InstanceDetails {
  return {
    instanceId: 'i-123',
    arn: 'arn:aws:ec2:sa-east-1:111122223333:instance/i-123',
    name: 'production-api',
    instanceType: 'm6i.xlarge',
    state: 'running',
    region: 'sa-east-1',
    availabilityZone: 'sa-east-1a',
    privateIpAddress: '10.0.11.58',
    vpcId: 'vpc-1',
    stoppedAt: null,
    platform: 'Linux/UNIX',
    architecture: 'x86_64',
    launchTime: null,
    tags: { Name: 'production-api' },
    volumeIds: ['vol-1'],
    vcpu: 4,
    memoryGiB: 16,
    ...overrides,
  };
}

function metrics(cpu: { avg: number; p95: number; max: number }, opts: { memP95?: number; netMb?: number; points?: number } = {}): Ec2UtilizationMetrics {
  const points = opts.points ?? 336;
  const netBytes = (opts.netMb ?? 500) * 1024 * 1024;
  return {
    periodDays: 14,
    collectedAt: new Date().toISOString(),
    cpu: { average: cpu.avg, p95: cpu.p95, max: cpu.max, datapoints: points },
    networkInBytesPerDay: netBytes / 2,
    networkOutBytesPerDay: netBytes / 2,
    memory:
      opts.memP95 === undefined
        ? { available: false, reason: MEMORY_UNAVAILABLE }
        : { available: true, usedPercent: { average: opts.memP95 - 5, p95: opts.memP95, max: opts.memP95 + 5, datapoints: points } },
  };
}

function optimizer(overrides: Partial<Ec2OptimizerRecommendation> = {}): Ec2OptimizerRecommendation {
  return {
    instanceArn: 'arn:aws:ec2:sa-east-1:111122223333:instance/i-123',
    instanceId: 'i-123',
    currentInstanceType: 'm6i.xlarge',
    finding: 'OVER_PROVISIONED',
    lookBackPeriodDays: 14,
    lastRefreshedAt: null,
    options: [
      { instanceType: 'm6i.large', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 54, savingsPercentage: 39.13, currency: 'USD', spec: M6I_LARGE },
      { instanceType: 'r6i.large', rank: 2, performanceRisk: 1, estimatedMonthlySavings: 20, savingsPercentage: 14.5, currency: 'USD', spec: null },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<Ec2AnalyzerInput> = {}): Ec2AnalyzerInput {
  return {
    instance: instance(),
    metrics: metrics({ avg: 21, p95: 38, max: 55 }, { memP95: 30 }),
    costExplorerMonthlyCost: 138,
    optimizer: optimizer(),
    downsizeCandidate: M6I_LARGE,
    onDemandMonthlyPrices: {},
    currency: 'USD',
    ...overrides,
  };
}

describe('Ec2AnalyzerService', () => {
  const analyzer = new Ec2AnalyzerService();

  it('produces the spec example: m6i.xlarge to m6i.large, US$ 54/month, low risk', () => {
    const { analysis, draft } = analyzer.analyze(input());

    expect(analysis.finding).toBe('RIGHTSIZE');
    expect(analysis.current).toMatchObject({ instanceType: 'm6i.xlarge', vcpu: 4, memoryGb: 16, monthlyCost: 138, costSource: 'COST_EXPLORER_RESOURCE' });
    expect(analysis.metrics).toMatchObject({ cpuAverage: 21, cpuP95: 38 });
    expect(analysis.recommendation).toMatchObject({ instanceType: 'm6i.large', vcpu: 2, memoryGb: 8, performanceRisk: Level.LOW });
    expect(analysis.reduction).toEqual({ vcpu: { from: 4, to: 2 }, memoryGb: { from: 16, to: 8 } });
    expect(analysis.savings).toEqual({ monthly: 54, yearly: 648, currency: 'USD' });

    expect(draft).toMatchObject({
      type: RecommendationType.EC2_RIGHTSIZING,
      source: RecommendationSource.COMPUTE_OPTIMIZER,
      currentMonthlyCost: 138,
      recommendedMonthlyCost: 84,
      estimatedMonthlySavings: 54,
      estimatedYearlySavings: 648,
      risk: Level.LOW,
      confidence: Level.HIGH,
      severity: Level.MEDIUM,
    });
  });

  it('raises risk to MEDIUM when memory shrinks and memory metrics are unavailable', () => {
    const { analysis, draft } = analyzer.analyze(input({ metrics: metrics({ avg: 21, p95: 38, max: 55 }) }));

    expect(analysis.metrics.memoryAvailable).toBe(false);
    expect(analysis.metrics.memoryP95).toBeNull();
    expect(analysis.metrics.notes).toContain('Memory metrics unavailable');
    expect(draft?.risk).toBe(Level.MEDIUM);
  });

  it('derives current cost from Compute Optimizer when Cost Explorer has no resource data', () => {
    const { analysis } = analyzer.analyze(input({ costExplorerMonthlyCost: null }));

    expect(analysis.current.costSource).toBe('COMPUTE_OPTIMIZER');
    expect(analysis.current.monthlyCost).toBeCloseTo(138, 0);
  });

  it('detects idle instances and estimates the full monthly cost as savings', () => {
    const { analysis, draft } = analyzer.analyze(
      input({ metrics: metrics({ avg: 0.5, p95: 1, max: 3 }, { netMb: 1 }), optimizer: null }),
    );

    expect(analysis.finding).toBe('IDLE');
    expect(draft).toMatchObject({ type: RecommendationType.EC2_IDLE, estimatedMonthlySavings: 138, risk: Level.MEDIUM });
  });

  it('falls back to the same-family heuristic when Compute Optimizer has no data', () => {
    const { analysis, draft } = analyzer.analyze(
      input({ optimizer: null, metrics: metrics({ avg: 10, p95: 20, max: 40 }, { memP95: 30 }) }),
    );

    expect(analysis.finding).toBe('RIGHTSIZE');
    expect(draft).toMatchObject({
      source: RecommendationSource.CCG_HEURISTIC,
      estimatedMonthlySavings: 69,
      risk: Level.LOW,
      confidence: Level.MEDIUM,
    });
  });

  it('skips the heuristic when projected memory would be too high', () => {
    const { draft } = analyzer.analyze(
      input({ optimizer: null, metrics: metrics({ avg: 10, p95: 20, max: 40 }, { memP95: 60 }) }),
    );

    expect(draft).toBeNull();
  });

  it('recommends rightsizing with null savings when cost is unknown (never invents money)', () => {
    const { analysis, draft } = analyzer.analyze(
      input({ optimizer: null, costExplorerMonthlyCost: null, metrics: metrics({ avg: 10, p95: 20, max: 40 }, { memP95: 30 }) }),
    );

    expect(analysis.current.costSource).toBe('UNAVAILABLE');
    expect(analysis.finding).toBe('RIGHTSIZE');
    expect(analysis.savings).toBeNull();
    expect(draft).toMatchObject({
      type: RecommendationType.EC2_RIGHTSIZING,
      estimatedMonthlySavings: null,
      estimatedYearlySavings: null,
      recommendedMonthlyCost: null,
      confidence: Level.LOW,
    });
  });

  it('downsizes burstable instances that keep vCPU but halve memory (t3.medium to t3.small)', () => {
    const { analysis, draft } = analyzer.analyze(
      input({
        instance: instance({ instanceType: 't3.medium', vcpu: 2, memoryGiB: 4 }),
        optimizer: null,
        costExplorerMonthlyCost: 30.37,
        downsizeCandidate: { instanceType: 't3.small', vcpu: 2, memoryGiB: 2, architectures: ['x86_64'] },
        metrics: metrics({ avg: 3.89, p95: 4.69, max: 43.67 }, { netMb: 762 }),
      }),
    );

    expect(analysis.finding).toBe('RIGHTSIZE');
    expect(analysis.reduction).toEqual({ vcpu: { from: 2, to: 2 }, memoryGb: { from: 4, to: 2 } });
    expect(draft).toMatchObject({ estimatedMonthlySavings: 15.19, risk: Level.MEDIUM, confidence: Level.LOW });
  });

  it('keeps idle recommendation with null savings when cost is unknown', () => {
    const { draft } = analyzer.analyze(
      input({ optimizer: null, costExplorerMonthlyCost: null, metrics: metrics({ avg: 0.5, p95: 1, max: 3 }, { netMb: 1 }) }),
    );

    expect(draft).toMatchObject({ type: RecommendationType.EC2_IDLE, estimatedMonthlySavings: null, estimatedYearlySavings: null });
  });

  describe('stopped instances', () => {
    const NOW = new Date('2026-11-17T00:00:00.000Z');
    const stopped = (stoppedAt: string | null) => instance({ state: 'stopped', stoppedAt });
    const volumes = [
      { volumeId: 'vol-a', monthlyCost: 0.96 },
      { volumeId: 'vol-b', monthlyCost: 1.2 },
    ];

    it('recommends snapshot and removal after the minimum stopped days, with attached volume cost as savings', () => {
      const { analysis, draft } = analyzer.analyze(input({ instance: stopped('2026-11-09T14:42:28.000Z'), attachedVolumes: volumes, now: NOW }));

      expect(analysis.finding).toBe('STOPPED');
      expect(draft).toMatchObject({
        type: RecommendationType.EC2_STOPPED,
        source: RecommendationSource.CCG_HEURISTIC,
        currentMonthlyCost: 2.16,
        recommendedMonthlyCost: 0,
        estimatedMonthlySavings: 2.16,
        estimatedYearlySavings: 25.92,
        targetKey: 'SNAPSHOT_AND_TERMINATE',
        title: 'Remove stopped instance production-api: snapshot and delete 2 volume(s)',
      });
    });

    it('keeps savings null instead of inventing 0 when no attached volume is known', () => {
      const { draft } = analyzer.analyze(input({ instance: stopped('2026-11-01T00:00:00.000Z'), attachedVolumes: [], now: NOW }));

      expect(draft).toMatchObject({ type: RecommendationType.EC2_STOPPED, estimatedMonthlySavings: null, recommendedMonthlyCost: null });
      expect(draft?.title).toBe('Remove stopped instance production-api: snapshot and delete its volumes');
    });

    it('keeps the volume list in the analysis to measure realized savings later', () => {
      const { analysis } = analyzer.analyze(input({ instance: stopped('2026-11-01T00:00:00.000Z'), attachedVolumes: volumes, now: NOW }));

      expect(analysis.stoppedVolumes).toEqual(volumes);
    });

    it('keeps savings null when a volume cost is unknown', () => {
      const { draft } = analyzer.analyze(
        input({ instance: stopped('2026-11-01T00:00:00.000Z'), attachedVolumes: [{ volumeId: 'vol-a', monthlyCost: null }], now: NOW }),
      );

      expect(draft).toMatchObject({ type: RecommendationType.EC2_STOPPED, estimatedMonthlySavings: null, currentMonthlyCost: null });
    });

    it('warns about a ghost Kubernetes node without acting on it', () => {
      const { draft } = analyzer.analyze(
        input({
          instance: stopped('2026-11-01T00:00:00.000Z'),
          attachedVolumes: volumes,
          kubernetesNode: { clusterName: 'tismoo-prd', nodeName: 'ip-10-0-11-177' },
          now: NOW,
        }),
      );

      expect(draft?.description).toContain('Node ip-10-0-11-177 is still registered in cluster tismoo-prd: remove it with kubectl delete node ip-10-0-11-177');
    });

    it('stays NOT_RUNNING when stopped recently or when the stop date is unknown', () => {
      for (const stoppedAt of ['2026-11-14T00:00:00.000Z', null]) {
        const { analysis, draft } = analyzer.analyze(input({ instance: stopped(stoppedAt), attachedVolumes: volumes, now: NOW }));
        expect(analysis.finding).toBe('NOT_RUNNING');
        expect(draft).toBeNull();
      }
    });
  });

  it('does not analyze stopped instances', () => {
    const { analysis, draft } = analyzer.analyze(input({ instance: instance({ state: 'stopped' }) }));

    expect(analysis.finding).toBe('NOT_RUNNING');
    expect(draft).toBeNull();
  });

  it('reports insufficient data without Compute Optimizer and with few datapoints', () => {
    const { analysis, draft } = analyzer.analyze(
      input({ optimizer: null, metrics: metrics({ avg: 10, p95: 20, max: 40 }, { points: 24 }) }),
    );

    expect(analysis.finding).toBe('INSUFFICIENT_DATA');
    expect(draft).toBeNull();
  });

  it('respects an OPTIMIZED finding from Compute Optimizer', () => {
    const { analysis, draft } = analyzer.analyze(
      input({ optimizer: optimizer({ finding: 'OPTIMIZED', options: [] }), metrics: metrics({ avg: 10, p95: 20, max: 40 }, { memP95: 30 }) }),
    );

    expect(analysis.finding).toBe('OPTIMIZED');
    expect(draft).toBeNull();
  });
});

describe('Ec2AnalyzerService with on-demand prices and Kubernetes nodes', () => {
  const analyzer = new Ec2AnalyzerService();
  const T3_SMALL: InstanceTypeSpec = { instanceType: 't3.small', vcpu: 2, memoryGiB: 2, architectures: ['x86_64'] };
  const T3_MICRO: InstanceTypeSpec = { instanceType: 't3.micro', vcpu: 2, memoryGiB: 1, architectures: ['x86_64'] };
  const lowCpu = metrics({ avg: 4, p95: 5, max: 44 }, { netMb: 700 });

  it('estimates cost and savings from on-demand prices when no other cost source exists', () => {
    const { analysis, draft } = analyzer.analyze(
      input({
        instance: instance({ name: 'reporting', instanceType: 't3.medium', vcpu: 2, memoryGiB: 4 }),
        optimizer: null,
        costExplorerMonthlyCost: null,
        downsizeCandidate: T3_SMALL,
        onDemandMonthlyPrices: { 't3.medium': 30.37, 't3.small': 15.18 },
        metrics: lowCpu,
      }),
    );

    expect(analysis.current).toMatchObject({ monthlyCost: 30.37, costSource: 'ON_DEMAND_PRICE' });
    expect(draft).toMatchObject({ estimatedMonthlySavings: 15.19, recommendedMonthlyCost: 15.18, estimatedYearlySavings: 182.28 });
    expect(draft?.analysis.recommendation?.reasons).toContain('Savings estimated from on-demand prices; RI/Savings Plans discounts not considered');
  });

  it('never shrinks a Kubernetes control plane below 2 GiB', () => {
    const { analysis, draft } = analyzer.analyze(
      input({
        instance: instance({ name: 'abrappe-ec2-kubernetes-master-1-prod', instanceType: 't3.small', vcpu: 2, memoryGiB: 2 }),
        optimizer: null,
        costExplorerMonthlyCost: null,
        downsizeCandidate: T3_MICRO,
        onDemandMonthlyPrices: { 't3.small': 15.18, 't3.micro': 7.59 },
        metrics: metrics({ avg: 8.6, p95: 10.4, max: 43 }, { netMb: 700 }),
      }),
    );

    expect(analysis.kubernetes).toMatchObject({ role: 'CONTROL_PLANE' });
    expect(analysis.finding).toBe('OPTIMIZED');
    expect(analysis.metrics.notes).toContain('Kubernetes control plane node needs at least 2 GiB; t3.micro (1 GiB) skipped');
    expect(draft).toBeNull();
  });

  it('flags HIGH risk when shrinking memory of a Kubernetes worker without memory metrics', () => {
    const { analysis, draft } = analyzer.analyze(
      input({
        instance: instance({ name: 'abrappe-ec2-kubernetes-worker-1-prod', instanceType: 't3.medium', vcpu: 2, memoryGiB: 4 }),
        optimizer: null,
        costExplorerMonthlyCost: null,
        downsizeCandidate: T3_SMALL,
        onDemandMonthlyPrices: { 't3.medium': 30.37, 't3.small': 15.18 },
        metrics: lowCpu,
      }),
    );

    expect(analysis.kubernetes).toMatchObject({ role: 'WORKER' });
    expect(draft).toMatchObject({ risk: Level.HIGH, confidence: Level.LOW, estimatedMonthlySavings: 15.19 });
    expect(draft?.analysis.recommendation?.reasons.join(' ')).toContain('draining the node first');
  });

  it('blocks downsizing to a burstable type whose baseline is below the projected CPU average', () => {
    const { analysis, draft } = analyzer.analyze(
      input({
        instance: instance({ name: 'batch', instanceType: 't3.large', vcpu: 2, memoryGiB: 8 }),
        optimizer: null,
        costExplorerMonthlyCost: 60,
        downsizeCandidate: { instanceType: 't3.medium', vcpu: 2, memoryGiB: 4, architectures: ['x86_64'] },
        metrics: metrics({ avg: 25, p95: 35, max: 60 }, { memP95: 20 }),
      }),
    );

    expect(draft).toBeNull();
    expect(analysis.metrics.notes).toContain('t3.medium baseline is 20% CPU; projected average 25% would drain CPU credits');
  });

  it('does not downsize instances already charging surplus CPU credits', () => {
    const m = metrics({ avg: 10, p95: 20, max: 40 }, { memP95: 20 });
    m.cpuCredits = { balanceMin: 0, balanceAvg: 5, surplusChargedTotal: 12 };
    const { analysis, draft } = analyzer.analyze(
      input({
        instance: instance({ name: 'api', instanceType: 't3.medium', vcpu: 2, memoryGiB: 4 }),
        optimizer: null,
        downsizeCandidate: { instanceType: 't3.small', vcpu: 2, memoryGiB: 2, architectures: ['x86_64'] },
        metrics: m,
      }),
    );

    expect(draft).toBeNull();
    expect(analysis.metrics.cpuSurplusCreditsCharged).toBe(12);
    expect(analysis.metrics.notes).toContain('CPU credit balance reached 0 during the period');
  });

  it('skips Compute Optimizer options below the Kubernetes memory floor', () => {
    const { draft } = analyzer.analyze(
      input({
        instance: instance({ name: 'cp', tags: { 'k8s.io/role/master': '1' }, instanceType: 't3.small', vcpu: 2, memoryGiB: 2 }),
        optimizer: optimizer({
          currentInstanceType: 't3.small',
          options: [
            { instanceType: 't3.micro', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 7, savingsPercentage: 50, currency: 'USD', spec: T3_MICRO },
          ],
        }),
      }),
    );

    expect(draft).toBeNull();
  });
});

describe('Ec2AnalyzerService usage profile and options', () => {
  const analyzer = new Ec2AnalyzerService();
  const spec = (instanceType: string, vcpu: number, memoryGiB: number, arch = 'x86_64'): InstanceTypeSpec => ({ instanceType, vcpu, memoryGiB, architectures: [arch] });
  const worker = instance({ name: 'k8s-worker-1', instanceType: 't3.medium', vcpu: 2, memoryGiB: 4 });
  const prices = { 't3.medium': 30.37, 't3.small': 15.18, 't3a.medium': 27.45, 't4g.medium': 24.53 };
  const typeSpecs = { 't3a.medium': spec('t3a.medium', 2, 4), 't4g.medium': spec('t4g.medium', 2, 4, 'arm64') };

  it('exposes peak usage in percent and in absolute vCPU', () => {
    const { analysis } = analyzer.analyze(
      input({ instance: worker, optimizer: null, costExplorerMonthlyCost: null, downsizeCandidate: spec('t3.small', 2, 2), onDemandMonthlyPrices: prices, typeSpecs, metrics: metrics({ avg: 4.8, p95: 5.3, max: 58.9 }) }),
    );

    expect(analysis.usage?.cpu).toMatchObject({ vcpuAvailable: 2, average: 4.8, p95: 5.3, max: 58.9, p95VcpuUsed: 0.11, peakVcpuUsed: 1.18 });
    expect(analysis.usage?.memory).toMatchObject({ available: false, gbAvailable: 4, peakGbUsed: null });
  });

  it('compares current, smaller and same-size alternatives so the user can choose', () => {
    const { analysis } = analyzer.analyze(
      input({ instance: worker, optimizer: null, costExplorerMonthlyCost: null, downsizeCandidate: spec('t3.small', 2, 2), onDemandMonthlyPrices: prices, typeSpecs, metrics: metrics({ avg: 4.8, p95: 5.3, max: 58.9 }) }),
    );

    const byType = Object.fromEntries((analysis.options ?? []).map((o) => [o.instanceType, o]));
    expect(analysis.options?.[0]).toMatchObject({ instanceType: 't3.medium', kind: 'CURRENT', monthlyCost: 30.37, fit: 'FITS' });
    expect(byType['t3.small']).toMatchObject({ kind: 'DOWNSIZE', monthlyCost: 15.18, monthlySavings: 15.19, fit: 'UNKNOWN' });
    expect(byType['t3a.medium']).toMatchObject({ kind: 'SAME_SIZE_ALTERNATIVE', monthlySavings: 2.92, fit: 'FITS' });
    expect(byType['t4g.medium']).toMatchObject({ monthlySavings: 5.84, fit: 'FITS' });
    expect(byType['t4g.medium'].notes.join(' ')).toContain('arm64');
    expect(analysis.options?.map((o) => o.instanceType)).toEqual(['t3.medium', 't3.small', 't4g.medium', 't3a.medium']);
  });

  it('turns UNKNOWN into a real verdict once the Kubernetes agent reports node memory', () => {
    const { analysis, draft } = analyzer.analyze(
      input({
        instance: worker,
        optimizer: null,
        costExplorerMonthlyCost: null,
        downsizeCandidate: spec('t3.small', 2, 2),
        onDemandMonthlyPrices: prices,
        typeSpecs,
        metrics: metrics({ avg: 4.8, p95: 5.3, max: 58.9 }),
        externalMemory: {
          clusterName: 'abrappe',
          nodeName: 'worker-1',
          role: 'worker',
          provider: 'SELF_MANAGED',
          usedPercent: { average: 55, p95: 62, max: 70, datapoints: 300 },
          requestsPercent: 40,
          allocatableGb: 3.4,
        },
      }),
    );

    expect(analysis.usage?.memory).toMatchObject({ available: true, source: 'KUBERNETES_AGENT', p95: 62, p95GbUsed: 2.48 });
    expect(analysis.kubernetes).toMatchObject({ cluster: 'abrappe', role: 'WORKER' });
    expect(analysis.options?.find((o) => o.instanceType === 't3.small')).toMatchObject({ fit: 'DOES_NOT_FIT', projected: { memoryP95: 124 } });
    expect(draft).toBeNull();
  });

  it('marks a smaller type as DOES_NOT_FIT when measured memory would not fit', () => {
    const { analysis } = analyzer.analyze(
      input({ instance: worker, optimizer: null, costExplorerMonthlyCost: null, downsizeCandidate: spec('t3.small', 2, 2), onDemandMonthlyPrices: prices, typeSpecs, metrics: metrics({ avg: 4.8, p95: 5.3, max: 58.9 }, { memP95: 70 }) }),
    );

    const small = analysis.options?.find((o) => o.instanceType === 't3.small');
    expect(analysis.usage?.memory).toMatchObject({ available: true, p95GbUsed: 2.8 });
    expect(small).toMatchObject({ fit: 'DOES_NOT_FIT', projected: { memoryP95: 140 } });
  });
});

describe('Ec2AnalyzerService special families', () => {
  const analyzer = new Ec2AnalyzerService();
  const gpu = (instanceType: string, vcpu: number, memoryGiB: number, accelerators: number, localStorageGb: number): InstanceTypeSpec => ({
    instanceType, vcpu, memoryGiB, architectures: ['x86_64'], accelerators, localStorageGb,
  });
  const g5 = instance({ instanceType: 'g5.2xlarge', vcpu: 8, memoryGiB: 32 });

  it('ignores the smaller-size heuristic and explains why', () => {
    const { analysis, draft } = analyzer.analyze(
      input({ instance: g5, optimizer: null, downsizeCandidate: gpu('g5.xlarge', 4, 16, 1, 250), metrics: metrics({ avg: 3, p95: 8, max: 20 }, { memP95: 10 }) }),
    );

    expect(draft).toBeNull();
    expect(analysis.options?.some((o) => o.kind === 'DOWNSIZE')).toBe(false);
    expect(analysis.metrics.notes.join(' ')).toContain('GPU');
  });

  it('marks options that lose GPU or local storage as DOES_NOT_FIT', () => {
    const { analysis } = analyzer.analyze(
      input({
        instance: instance({ instanceType: 'g4dn.xlarge', vcpu: 4, memoryGiB: 16 }),
        optimizer: optimizer({
          currentInstanceType: 'g4dn.xlarge',
          options: [
            { instanceType: 'm6i.xlarge', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 200, savingsPercentage: 50, currency: 'USD', spec: gpu('m6i.xlarge', 4, 16, 0, 0) },
            { instanceType: 'g4dn.2xlarge', rank: 2, performanceRisk: 1, estimatedMonthlySavings: 10, savingsPercentage: 2, currency: 'USD', spec: gpu('g4dn.2xlarge', 8, 32, 1, 225) },
          ],
        }),
        downsizeCandidate: null,
        typeSpecs: { 'g4dn.xlarge': gpu('g4dn.xlarge', 4, 16, 1, 125) },
        metrics: metrics({ avg: 3, p95: 8, max: 20 }, { memP95: 10 }),
      }),
    );

    const byType = Object.fromEntries((analysis.options ?? []).map((o) => [o.instanceType, o]));
    expect(byType['m6i.xlarge'].fit).toBe('DOES_NOT_FIT');
    expect(byType['m6i.xlarge'].notes.join(' ')).toContain('GPU/accelerators');
    expect(byType['g4dn.2xlarge'].fit).not.toBe('DOES_NOT_FIT');
  });
});

describe('Ec2AnalyzerService upsize', () => {
  const analyzer = new Ec2AnalyzerService();
  const T3A_SMALL: InstanceTypeSpec = { instanceType: 't3a.small', vcpu: 2, memoryGiB: 2, architectures: ['x86_64'] };
  const micro = (memP95: number, extra: Partial<Ec2AnalyzerInput> = {}) =>
    input({
      instance: instance({ instanceType: 't3a.micro', vcpu: 2, memoryGiB: 1 }),
      metrics: metrics({ avg: 20, p95: 40, max: 70 }, { memP95 }),
      costExplorerMonthlyCost: null,
      optimizer: null,
      downsizeCandidate: null,
      upsizeCandidate: T3A_SMALL,
      onDemandMonthlyPrices: { 't3a.micro': 6.86, 't3a.small': 13.72 },
      ...extra,
    });

  it('recommends the next size up when current memory usage does not fit', () => {
    const { analysis, draft } = analyzer.analyze(micro(95));

    expect(analysis.finding).toBe('UPSIZE');
    expect(analysis.options?.find((o) => o.kind === 'UPSIZE')).toMatchObject({ instanceType: 't3a.small', fit: 'FITS' });
    expect(draft).toMatchObject({
      type: RecommendationType.EC2_UPSIZE,
      title: 'Upsize production-api: t3a.micro to t3a.small',
      currentMonthlyCost: 6.86,
      recommendedMonthlyCost: 13.72,
      estimatedMonthlySavings: null,
      estimatedYearlySavings: null,
      risk: Level.HIGH,
      targetKey: 't3a.small',
    });
    expect(draft?.description).toContain('Current usage does not fit t3a.micro');
    expect(draft?.description).toContain('Cost increase: USD 6.86/month');
  });

  it('follows Compute Optimizer when it reports the instance as under-provisioned', () => {
    const { draft } = analyzer.analyze(
      micro(50, {
        optimizer: optimizer({
          currentInstanceType: 't3a.micro',
          finding: 'UNDER_PROVISIONED',
          options: [{ instanceType: 't3a.small', rank: 1, performanceRisk: 1, estimatedMonthlySavings: null, savingsPercentage: null, currency: 'USD', spec: T3A_SMALL }],
        }),
        upsizeCandidate: null,
      }),
    );

    expect(draft).toMatchObject({ type: RecommendationType.EC2_UPSIZE, targetKey: 't3a.small', source: RecommendationSource.COMPUTE_OPTIMIZER });
    expect(draft?.description).toContain('Compute Optimizer reports the instance as under-provisioned');
  });

  it('recommends upsizing a burstable instance that keeps paying surplus CPU credits', () => {
    const base = micro(50);
    const { draft } = analyzer.analyze({ ...base, metrics: { ...base.metrics!, cpuCredits: { balanceMin: 0, balanceAvg: 5, surplusChargedTotal: 30 } } });

    expect(draft).toMatchObject({ type: RecommendationType.EC2_UPSIZE, targetKey: 't3a.small' });
    expect(draft?.description).toContain('surplus CPU credits');
  });

  it('does not upsize for surplus credits to a size with the same CPU baseline', () => {
    const T3A_MEDIUM: InstanceTypeSpec = { instanceType: 't3a.medium', vcpu: 2, memoryGiB: 4, architectures: ['x86_64'] };
    const base = input({
      instance: instance({ instanceType: 't3a.small', vcpu: 2, memoryGiB: 2 }),
      metrics: { ...metrics({ avg: 20, p95: 40, max: 70 }, { memP95: 30 }), cpuCredits: { balanceMin: 0, balanceAvg: 5, surplusChargedTotal: 30 } },
      costExplorerMonthlyCost: null,
      optimizer: null,
      downsizeCandidate: null,
      upsizeCandidate: T3A_MEDIUM,
      onDemandMonthlyPrices: { 't3a.small': 13.72, 't3a.medium': 27.45 },
    });

    const { analysis, draft } = analyzer.analyze(base);

    expect(draft).toBeNull();
    expect(analysis.metrics.notes.join(' ')).toContain('t3a.medium does not raise the CPU baseline');
  });

  it('does not upsize a Kubernetes node that is only full of pod memory requests', () => {
    const { analysis, draft } = analyzer.analyze(
      micro(30, {
        metrics: metrics({ avg: 20, p95: 40, max: 70 }),
        externalMemory: {
          clusterName: 'prd',
          nodeName: 'worker-1',
          role: 'worker',
          provider: 'SELF_MANAGED',
          usedPercent: { average: 35, p95: 40, max: 45, datapoints: 300 },
          requestsPercent: 95,
          allocatableGb: 0.8,
        },
      }),
    );

    expect(analysis.options?.find((o) => o.kind === 'CURRENT')?.fit).toBe('DOES_NOT_FIT');
    expect(draft).toBeNull();
    expect(analysis.metrics.notes.join(' ')).toContain('Pod memory requests reach 95% of the node');
  });

  it('explains when no larger size is known and creates no recommendation', () => {
    const { analysis, draft } = analyzer.analyze(micro(95, { upsizeCandidate: null }));

    expect(draft).toBeNull();
    expect(analysis.metrics.notes).toContain('Current usage does not fit t3a.micro, but no larger size found for t3a.micro');
  });

  it('leaves instances that fit alone', () => {
    const { analysis } = analyzer.analyze(micro(50));

    expect(analysis.finding).not.toBe('UPSIZE');
  });
});

describe('upsizeCandidateType', () => {
  it.each([
    ['t3a.small', 't3a.medium'],
    ['t3.nano', 't3.micro'],
    ['m5.large', 'm5.xlarge'],
    ['m5.xlarge', 'm5.2xlarge'],
    ['m5.2xlarge', 'm5.4xlarge'],
    ['p3.2xlarge', null],
    ['m5.metal', null],
  ])('%s -> %s', (type, expected) => {
    expect(upsizeCandidateType(type)).toBe(expected);
  });
});

describe('downsizeCandidateType', () => {
  it.each([
    ['m6i.xlarge', 'm6i.large'],
    ['m6i.large', 'm6i.medium'],
    ['c5.2xlarge', 'c5.xlarge'],
    ['r6g.16xlarge', 'r6g.8xlarge'],
    ['t3.micro', 't3.nano'],
    ['t3.nano', null],
    ['m5.metal', null],
    ['c5.9xlarge', null],
    ['g5.2xlarge', null],
    ['i3.2xlarge', null],
    ['m5d.2xlarge', null],
    ['c5n.2xlarge', null],
  ])('%s -> %s', (from, to) => {
    expect(downsizeCandidateType(from)).toBe(to);
  });
});

describe('mapPerformanceRisk', () => {
  it.each([
    [0, Level.LOW],
    [1, Level.LOW],
    [2, Level.MEDIUM],
    [3, Level.HIGH],
    [null, Level.MEDIUM],
  ])('%s -> %s', (value, level) => {
    expect(mapPerformanceRisk(value)).toBe(level);
  });
});
