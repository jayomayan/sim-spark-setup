import { describe, expect, it } from "vitest";
import { matchCustomFields } from "@/lib/sim-custom-fields";

const accountFields = [
  { id: "7106", fieldName: "72000407" },
  { id: "2608", fieldName: "Label#" },
];

describe("SIM activation custom fields", () => {
  it("writes the Site ID into the account's existing Label# field", () => {
    const { customFields, missing } = matchCustomFields(accountFields, { label: "PH010065" });
    expect(customFields).toEqual([{ fieldName: "Label#", fieldValue: "PH010065", fieldId: 2608 }]);
    expect(missing).toEqual([]);
  });

  it("reports Label as missing instead of sending an unknown field", () => {
    const { customFields, missing } = matchCustomFields([{ id: "7106", fieldName: "72000407" }], { label: "PH010065" });
    expect(customFields).toEqual([]);
    expect(missing).toEqual(["Label"]);
  });
});
