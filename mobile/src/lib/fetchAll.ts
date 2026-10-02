// Supabase answers a plain select with at most ~1000 rows. A long or busy
// challenge has more progress rows than that (one per person per day), and a
// silently short answer undercounts steps. This reads every page.
//
// `build` must return a fresh query each call, ordered on columns that are
// unique together, so pages never overlap or skip a row.
const PAGE_SIZE = 1000;

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
