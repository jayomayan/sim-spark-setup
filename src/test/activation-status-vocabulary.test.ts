import { describe, expect, it } from "vitest";
import { ACTIVATION_STATUSES, ACTIVATION_STATUS_DESCRIPTIONS, OPEN_STATUSES } from "@/lib/activation-process";

describe("activation process status vocabulary", () => {
  it("records exactly the six agreed states", () => {
    expect([...ACTIVATION_STATUSES]).toEqual(["INITIATED", "IN_PROGRESS", "RETRYING", "COMPLETED", "UNFINISHED", "TERMINATED"]);
  });

  it("keeps the published meaning of every state", () => {
    expect(ACTIVATION_STATUS_DESCRIPTIONS).toEqual({
      INITIATED: "Activation process has started.",
      IN_PROGRESS: "Activation is currently being processed.",
      RETRYING: "IP acquisition or firewall configuration is being retried.",
      COMPLETED: "All required activation steps have completed successfully.",
      UNFINISHED: "Process was interrupted or abandoned before completion.",
      TERMINATED: "Process was automatically terminated due to timeout.",
    });
  });

  it("keeps only the working states open for a retry or the 3-minute cleanup", () => {
    expect([...OPEN_STATUSES]).toEqual(["INITIATED", "IN_PROGRESS", "RETRYING"]);
    expect(ACTIVATION_STATUSES.filter((status) => !OPEN_STATUSES.includes(status))).toEqual(["COMPLETED", "UNFINISHED", "TERMINATED"]);
  });

  it("describes every state it can record", () => {
    for (const status of ACTIVATION_STATUSES) {
      expect(ACTIVATION_STATUS_DESCRIPTIONS[status]).toMatch(/[a-z]/);
    }
  });
});
