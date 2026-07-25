type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

const DEFAULT_PAGE_SIZE = 1000;

// fetchAllRows loads a query in `.range()` pages until a short page arrives, so list
// results are never silently truncated by the PostgREST per-request row cap.
export async function fetchAllRows<T>(
  errorLabel: string,
  buildPageQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const pages: T[][] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPageQuery(from, from + pageSize - 1);

    if (error) {
      throw new Error(`${errorLabel}: ${error.message}`);
    }

    const rows = data ?? [];
    pages.push(rows);

    if (rows.length < pageSize) {
      break;
    }
  }

  return pages.flat();
}
