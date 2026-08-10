import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourcePath = resolve("public/icons/vosio-192.png");
const outputPath = resolve("app/favicon.ico");

// createSingleImageIco wraps one tracked square PNG in the standard ICO directory structure.
function createSingleImageIco(png) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error("Favicon source must be a PNG image.");
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== height || width < 1 || width > 256) {
    throw new Error("Favicon source must be a square PNG between 1px and 256px.");
  }

  const directory = Buffer.alloc(22);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(1, 4);
  directory.writeUInt8(width === 256 ? 0 : width, 6);
  directory.writeUInt8(height === 256 ? 0 : height, 7);
  directory.writeUInt8(0, 8);
  directory.writeUInt8(0, 9);
  directory.writeUInt16LE(1, 10);
  directory.writeUInt16LE(32, 12);
  directory.writeUInt32LE(png.length, 14);
  directory.writeUInt32LE(directory.length, 18);
  return Buffer.concat([directory, png]);
}

const png = await readFile(sourcePath);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, createSingleImageIco(png));
