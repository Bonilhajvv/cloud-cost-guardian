import { parseInstanceType, sameSizeAlternatives, sameSizeTypePattern, specialFamilyReason } from './instance-family.helper';

describe('parseInstanceType', () => {
  it.each([
    ['m5.large', { instanceClass: 'm', generation: 5, processor: '', features: '', size: 'large' }],
    ['c7gd.xlarge', { instanceClass: 'c', generation: 7, processor: 'g', features: 'd', size: 'xlarge' }],
    ['m6idn.2xlarge', { instanceClass: 'm', generation: 6, processor: 'i', features: 'dn', size: '2xlarge' }],
    ['m7i-flex.large', { instanceClass: 'm', generation: 7, processor: 'i', features: '-flex', size: 'large' }],
    ['inf2.xlarge', { instanceClass: 'inf', generation: 2, processor: '', features: '', size: 'xlarge' }],
  ])('%s', (type, expected) => {
    expect(parseInstanceType(type)).toEqual(expected);
  });

  it('returns null for names outside the pattern', () => {
    expect(parseInstanceType('u-6tb1.metal')).toBeNull();
  });
});

describe('specialFamilyReason', () => {
  it.each([
    'p4d.24xlarge', 'g5.xlarge', 'g4dn.xlarge', 'inf2.xlarge', 'trn1.2xlarge', 'dl1.24xlarge', 'f1.2xlarge', 'vt1.3xlarge',
    'i3.xlarge', 'i4i.large', 'im4gn.large', 'is4gen.large', 'd3.xlarge', 'h1.2xlarge',
    'm5d.large', 'c6gd.xlarge', 'z1d.large', 'c5n.large', 'c6in.large', 'r5b.large', 'm5zn.large', 'x2idn.16xlarge',
    'mac1.metal', 'mac2-m2pro.metal', 'u-6tb1.metal', 'u7i-12tb.224xlarge', 'hpc6a.48xlarge',
  ])('%s is special', (type) => {
    expect(specialFamilyReason(type)).not.toBeNull();
  });

  it.each(['m5.large', 't3.medium', 'c7g.xlarge', 'r6a.large', 'm7i-flex.large', 'x1e.xlarge', 'r7iz.large', 'a1.large'])(
    '%s is regular',
    (type) => {
      expect(specialFamilyReason(type)).toBeNull();
    },
  );
});

describe('sameSizeAlternatives', () => {
  const available = [
    'm5.large', 'm5a.large', 'm5d.large', 'm5n.large', 'm5zn.large', 'm4.large', 'm6i.large', 'm6a.large', 'm6g.large',
    'm6gd.large', 'm7g.large', 'm7i-flex.large', 'm6i.xlarge', 'mac1.metal', 'm5dn.large', 'm6id.large', 'm6idn.large',
  ];

  it('keeps same class, size and features with equal or newer generation', () => {
    expect(sameSizeAlternatives('m5.large', available)).toEqual(['m5a.large', 'm6a.large', 'm6g.large', 'm6i.large', 'm7g.large']);
  });

  it('keeps the d variant for local storage families', () => {
    expect(sameSizeAlternatives('m5d.large', available)).toEqual(['m6gd.large', 'm6id.large']);
  });

  it('keeps the dn variant', () => {
    expect(sameSizeAlternatives('m5dn.large', available)).toEqual(['m6idn.large']);
  });

  it('returns nothing for unparseable types', () => {
    expect(sameSizeAlternatives('u-6tb1.metal', available)).toEqual([]);
  });

  it('builds the DescribeInstanceTypes wildcard', () => {
    expect(sameSizeTypePattern('c6gd.2xlarge')).toBe('c*.2xlarge');
    expect(sameSizeTypePattern('u-6tb1.metal')).toBeNull();
  });
});
