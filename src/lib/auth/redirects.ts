// getSafeNextPath keeps auth redirects inside the Vosio app.
export function getSafeNextPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
