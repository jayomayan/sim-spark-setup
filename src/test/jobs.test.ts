import { describe, expect, it } from "vitest";
import { isPrivateIp } from "@/lib/jobs";

describe("isPrivateIp", () => {
  it("accepts private router ranges", () => {
    expect(isPrivateIp("10.194.72.40")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
  });
  it("rejects public or malformed addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("10.0.0.300")).toBe(false);
    expect(isPrivateIp("PH010010")).toBe(false);
  });
});
