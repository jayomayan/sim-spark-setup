export const JOB_TYPES = ["ping", "snmp_walk", "device_ntp", "ur35_firewall", "ur35_ntp"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export function isSupportedJobType(type: string): type is JobType {
  return JOB_TYPES.some((supported) => supported === type);
}