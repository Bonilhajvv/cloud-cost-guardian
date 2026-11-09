import { PROCESSOR_LETTERS, SPECIAL_FEATURE_LETTERS, SPECIAL_INSTANCE_CLASSES } from '../constants/instance-family.constant';
import { ParsedInstanceType } from '../interfaces/instance-family.interface';

const INSTANCE_TYPE_PATTERN = /^([a-z]+)(\d+)([a-z]*)(?:-([a-z]+))?\.([a-z0-9]+)$/;

export function parseInstanceType(instanceType: string): ParsedInstanceType | null {
  const match = INSTANCE_TYPE_PATTERN.exec(instanceType);
  if (!match) return null;
  const [, instanceClass, generation, attributes, suffix, size] = match;
  const processor = PROCESSOR_LETTERS.includes(attributes.charAt(0)) ? attributes.charAt(0) : '';
  const letters = processor ? attributes.slice(1) : attributes;
  return {
    instanceClass,
    generation: Number(generation),
    processor,
    features: suffix ? `${letters}-${suffix}` : letters,
    size,
  };
}

export function specialFamilyReason(instanceType: string): string | null {
  if (/^u[0-9a-z]*-/.test(instanceType)) return 'high memory (u-*)';
  if (instanceType.startsWith('mac')) return SPECIAL_INSTANCE_CLASSES.mac;
  const parsed = parseInstanceType(instanceType);
  if (!parsed) return null;
  const byClass = SPECIAL_INSTANCE_CLASSES[parsed.instanceClass];
  if (byClass) return byClass;
  const letters = parsed.features.split('-')[0];
  const feature = [...letters].find((l) => SPECIAL_FEATURE_LETTERS[l]);
  return feature ? SPECIAL_FEATURE_LETTERS[feature] : null;
}

export function sameSizeTypePattern(instanceType: string): string | null {
  const parsed = parseInstanceType(instanceType);
  return parsed ? `${parsed.instanceClass}*.${parsed.size}` : null;
}

export function sameSizeAlternatives(instanceType: string, availableTypes: readonly string[]): string[] {
  const current = parseInstanceType(instanceType);
  if (!current) return [];
  return availableTypes
    .filter((type) => {
      if (type === instanceType) return false;
      const c = parseInstanceType(type);
      return (
        !!c &&
        c.instanceClass === current.instanceClass &&
        c.size === current.size &&
        c.features === current.features &&
        c.generation >= current.generation
      );
    })
    .sort();
}
