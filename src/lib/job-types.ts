export const JOB_TYPES = ["ping", "snmp_walk", "ur35_firewall", "ur35_misc", "site_capture", "site_ping"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const isSupportedJobType = (type: string): type is JobType =>
  (JOB_TYPES as readonly string[]).includes(type);
