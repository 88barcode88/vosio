const malformedPercentEncoding = /%(?![0-9a-f]{2})/i;
const encodedControl = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const encodedPathSeparator = /%(?:2f|5c)/i;

// containsUnsafeRedirectCharacter finds URL-parser-sensitive backslashes and controls.
function containsUnsafeRedirectCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\" || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}

// getSafeNextPath keeps auth redirects inside the Vosio app.
export function getSafeNextPath(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    containsUnsafeRedirectCharacter(value) ||
    malformedPercentEncoding.test(value) ||
    encodedControl.test(value)
  ) {
    return "/";
  }

  try {
    decodeURIComponent(value);
  } catch {
    return "/";
  }

  const queryIndex = value.indexOf("?");
  const fragmentIndex = value.indexOf("#");
  const pathnameEnd = Math.min(
    queryIndex === -1 ? value.length : queryIndex,
    fragmentIndex === -1 ? value.length : fragmentIndex
  );
  let inspectedPathname = value.slice(0, pathnameEnd);

  while (inspectedPathname.includes("%")) {
    if (encodedPathSeparator.test(inspectedPathname) || encodedControl.test(inspectedPathname)) {
      return "/";
    }

    try {
      const decodedPathname = decodeURIComponent(inspectedPathname);
      if (decodedPathname === inspectedPathname) {
        break;
      }

      if (
        decodedPathname.startsWith("//") ||
        containsUnsafeRedirectCharacter(decodedPathname)
      ) {
        return "/";
      }

      inspectedPathname = decodedPathname;
    } catch {
      break;
    }
  }

  return value;
}
