// Leave space below Firestore's 10 MiB request limit for encoding overhead.
export function importGroups(
  rows,
  { maxBytes = 3000000, maxWrites = 100 } = {},
) {
  const groups = [];
  let group = [],
    size = 0;
  for (const row of rows) {
    const bytes = new TextEncoder().encode(JSON.stringify(row[1])).length;
    if (bytes > maxBytes)
      throw new Error("Одна запись превышает размер пакета");
    if (
      group.length &&
      (group.length >= maxWrites || size + bytes > maxBytes)
    ) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(row);
    size += bytes;
  }
  if (group.length) groups.push(group);
  return groups;
}
