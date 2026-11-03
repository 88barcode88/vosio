// buildDownloadFileName turns the requested recording name into a safe ASCII attachment name with the stored object's extension.
export function buildDownloadFileName(requestedName: string | null, storagePath: string) {
  const objectName = storagePath.split("/").pop() ?? "";
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(objectName)?.[1]?.toLowerCase();
  const base = (requestedName ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/[\s-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80)
    .replace(/[-.]+$/g, "");
  const safeBase = base || "nahravka";
  return extension ? `${safeBase}.${extension}` : safeBase;
}
