export const JOB_TYPES = ["ping", "snmp_walk", "ur35_firewall", "ur35_ntp", "site_capture", "site_ping"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export function isSupportedJobType(type: string): type is JobType {
  return JOB_TYPES.some((supported) => supported === type);
}
