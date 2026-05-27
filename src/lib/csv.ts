/** 简单 CSV 行解析：支持双引号字段、逗号分隔、UTF-8 BOM */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsv(text: string): string[][] {
  const t = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = t.split("\n").filter((ln) => ln.trim().length > 0);
  return lines.map(parseCsvLine);
}

export function rowsToObjects(
  headers: string[],
  rows: string[][],
): Record<string, string>[] {
  return rows.map((cols) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h.trim()] = cols[i]?.trim() ?? "";
    });
    return o;
  });
}
