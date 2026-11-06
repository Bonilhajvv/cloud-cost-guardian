import { buildEbsUtilization } from './build-ebs-utilization.helper';

describe('buildEbsUtilization', () => {
  it('sums read and write per hour into IOPS and MB/s', () => {
    const t = [1, 2];
    const result = buildEbsUtilization(
      {
        readOps: { timestamps: t, values: [3600, 7200] },
        writeOps: { timestamps: t, values: [3600, 0] },
        readBytes: { timestamps: t, values: [3600 * 1024 * 1024, 0] },
        writeBytes: { timestamps: t, values: [0, 0] },
        burstBalance: { timestamps: t, values: [100, 80] },
      },
      14,
      new Date(),
    );

    expect(result).toMatchObject({ avgIops: 2, peakIops: 2, peakThroughputMBps: 1, avgThroughputMBps: 0.5, burstBalanceMin: 80, datapoints: 2 });
  });

  it('returns nulls without datapoints', () => {
    expect(buildEbsUtilization({}, 14, new Date())).toMatchObject({ avgIops: null, peakIops: null, burstBalanceMin: null, datapoints: 0 });
  });
});
