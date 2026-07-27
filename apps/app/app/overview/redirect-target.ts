export type RouteSearchParams = Record<string, string | string[] | undefined>;

export function buildRedirectTarget(pathname: string, searchParams: RouteSearchParams): string {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(name, item);
    } else if (value !== undefined) {
      query.set(name, value);
    }
  }

  const serializedQuery = query.toString();
  return serializedQuery ? `${pathname}?${serializedQuery}` : pathname;
}
