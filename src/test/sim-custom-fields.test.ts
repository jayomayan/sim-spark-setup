import { describe, expect, it } from "vitest";
import { matchCustomFields } from "@/lib/activation.functions";

const accountFields = [
  { id: "7106", fieldName: "72000407" },
  { id: "2608", fieldName: "Label#" },
];

describe("SIM activation custom fields", () => {
  it("writes the Site ID into the account's existing Label# field", () => {
    const { customFields } = matchCustomFields(accountFields, { label: "PH010065" });
    expect(customFields).toEqual([{ fieldName: "Label#", fieldValue: "PH010065", fieldId: 2608 }]);
  });

  it("reports Notes as missing instead of sending an unknown field", () => {
    const { customFields, missing } = matchCustomFields(accountFields, { label: "PH010065", notes: "GPS-Battery" });
    expect(customFields.map((f) => f.fieldName)).toEqual(["Label#"]);
    expect(missing).toEqual(["Notes"]);
  });

  it("uses a Notes field when one exists", () => {
    const { customFields } = matchCustomFields([...accountFields, { id: 9, fieldName: "Notes" }], { notes: "GPS-Genset" });
    expect(customFields).toEqual([{ fieldName: "Notes", fieldValue: "GPS-Genset", fieldId: 9 }]);
  });
});
