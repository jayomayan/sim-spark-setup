/** Match the account's existing custom fields: "Label", "Labels", "Label#" / "Note", "Notes". */
export function matchCustomFields(
  items: { id?: string | number; fieldName?: string }[],
  values: { label?: string | undefined; notes?: string | undefined },
) {
  const find = (re: RegExp) => items.find((f) => f.fieldName && re.test(f.fieldName.trim()));
  const wanted: [string, RegExp, string | undefined][] = [
    ["Label", /^labels?\s*#?$/i, values.label],
    ["Notes", /^notes?\s*#?$/i, values.notes],
  ];
  const customFields: { fieldName: string; fieldValue: string; fieldId?: number }[] = [];
  const missing: string[] = [];
  for (const [name, re, value] of wanted) {
    if (!value) continue;
    const f = find(re);
    if (!f?.fieldName) {
      missing.push(name);
      continue;
    }
    const id = Number(f.id);
    customFields.push({ fieldName: f.fieldName, fieldValue: value, ...(Number.isFinite(id) ? { fieldId: id } : {}) });
  }
  return { customFields, missing };
}
