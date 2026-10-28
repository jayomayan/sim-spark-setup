import { describe, expect, it } from "vitest";
import { encryptPassword, decryptPassword } from "../lib/db-connection.server";

describe("database connection credentials", () => {
  it("encrypts passwords so the plaintext never appears in storage", () => {
    const cipher = encryptPassword("S3cret-Pa55word");
    expect(cipher).not.toContain("S3cret-Pa55word");
    expect(cipher).not.toEqual(encryptPassword("S3cret-Pa55word"));
  });

  it("decrypts back to the original password", () => {
    expect(decryptPassword(encryptPassword("S3cret-Pa55word"))).toBe("S3cret-Pa55word");
  });
});
