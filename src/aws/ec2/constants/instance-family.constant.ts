export const SPECIAL_INSTANCE_CLASSES: Record<string, string> = {
  p: 'GPU',
  g: 'GPU',
  gr: 'GPU',
  inf: 'inference accelerators',
  trn: 'training accelerators',
  dl: 'deep learning accelerators',
  f: 'FPGA',
  vt: 'video transcoding accelerators',
  i: 'local NVMe storage',
  im: 'local NVMe storage',
  is: 'local NVMe storage',
  d: 'local dense storage',
  h: 'local dense storage',
  mac: 'dedicated Mac host',
  hpc: 'HPC networking',
};

export const SPECIAL_FEATURE_LETTERS: Record<string, string> = {
  d: 'local NVMe storage',
  n: 'enhanced networking',
  b: 'dedicated EBS bandwidth',
};

export const PROCESSOR_LETTERS = ['i', 'a', 'g'];
