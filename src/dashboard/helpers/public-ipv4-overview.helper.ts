import { HOURS_PER_MONTH } from '../../aws/pricing/constants/pricing.constant';
import { NetworkSnapshot } from '../../aws/network/interfaces/network.interface';
import { round } from '../../common/helpers/stats.helper';
import { PublicIpv4Overview } from '../interfaces/public-ipv4-overview.interface';

export function publicIpv4Overview(snapshots: (NetworkSnapshot | null)[]): PublicIpv4Overview {
  const known = snapshots.filter((s): s is NetworkSnapshot => s !== null);
  const addresses = known.flatMap((s) => s.publicIpv4.map((ip) => ({ ...ip, hourly: s.publicIpv4Hourly })));
  const byOwner: Record<string, number> = {};
  for (const ip of addresses) byOwner[ip.owner] = (byOwner[ip.owner] ?? 0) + 1;
  const priced = addresses.every((ip) => ip.hourly !== null);
  return {
    addresses: addresses.length,
    monthlyCost: known.length === 0 || !priced ? null : round(addresses.reduce((s, ip) => s + (ip.hourly ?? 0) * HOURS_PER_MONTH, 0)),
    byOwner,
    unattached: byOwner.UNATTACHED ?? 0,
  };
}
