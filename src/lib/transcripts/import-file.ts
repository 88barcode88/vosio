import { inflateRawSync } from "node:zlib";
import {
  getImportedTranscriptFileExtension,
  getImportedTranscriptFileValidationError,
  normalizeImportedTranscriptText
} from "@/lib/transcripts/manual-import";

type ZipEntry = {
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  name: string;
};

// Hard cap for inflated DOCX XML. WordprocessingML has large markup overhead, so 64 MB
// comfortably fits a maximum-length transcript while blocking zip-bomb payloads.
const DOCX_MAX_INFLATED_BYTES = 64 * 1024 * 1024;

// readUInt16 reads a little-endian 16-bit ZIP field.
function readUInt16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

// readUInt32 reads a little-endian 32-bit ZIP field.
function readUInt32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>> 0
  );
}

// findZipEndOfCentralDirectory locates the ZIP directory footer in a DOCX file.
function findZipEndOfCentralDirectory(bytes: Uint8Array) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readUInt32(bytes, offset) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
}

// readZipEntries reads central-directory metadata for a minimal DOCX text extraction.
function readZipEntries(bytes: Uint8Array) {
  const endOffset = findZipEndOfCentralDirectory(bytes);

  if (endOffset < 0) {
    throw new Error("DOCX soubor nejde přečíst.");
  }

  const entryCount = readUInt16(bytes, endOffset + 10);
  const centralDirectoryOffset = readUInt32(bytes, endOffset + 16);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(bytes, offset) !== 0x02014b50) {
      throw new Error("DOCX soubor má neplatný ZIP index.");
    }

    const compressionMethod = readUInt16(bytes, offset + 10);
    const compressedSize = readUInt32(bytes, offset + 20);
    const fileNameLength = readUInt16(bytes, offset + 28);
    const extraLength = readUInt16(bytes, offset + 30);
    const commentLength = readUInt16(bytes, offset + 32);
    const localHeaderOffset = readUInt32(bytes, offset + 42);
    const nameStart = offset + 46;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));

    entries.push({ compressedSize, compressionMethod, localHeaderOffset, name });
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

// readZipEntry inflates one ZIP entry from a DOCX file.
function readZipEntry(bytes: Uint8Array, entry: ZipEntry) {
  const localOffset = entry.localHeaderOffset;

  if (readUInt32(bytes, localOffset) !== 0x04034b50) {
    throw new Error("DOCX soubor má neplatný obsah.");
  }

  const fileNameLength = readUInt16(bytes, localOffset + 26);
  const extraLength = readUInt16(bytes, localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressed;
  }

  if (entry.compressionMethod === 8) {
    try {
      return inflateRawSync(compressed, { maxOutputLength: DOCX_MAX_INFLATED_BYTES });
    } catch {
      throw new Error("DOCX soubor je poškozený nebo příliš velký po rozbalení.");
    }
  }

  throw new Error("DOCX soubor používá nepodporovanou kompresi.");
}

// decodeXmlText decodes the XML entities commonly present in Word text nodes.
function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// extractTextFromDocxXml converts WordprocessingML text runs into readable plain text.
function extractTextFromDocxXml(xml: string) {
  const parts: string[] = [];
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^/]*\/>|<w:br\b[^/]*\/>|<\/w:p>/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(xml)) !== null) {
    if (match[1] !== undefined) {
      parts.push(decodeXmlText(match[1]));
      continue;
    }

    if (match[0].startsWith("<w:tab")) {
      parts.push("\t");
      continue;
    }

    parts.push("\n");
  }

  return normalizeImportedTranscriptText(parts.join(""));
}

// extractTextFromDocx extracts plain text from the main document part of a DOCX file.
export function extractTextFromDocx(bytes: Uint8Array) {
  const entries = readZipEntries(bytes);
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");

  if (!documentEntry) {
    throw new Error("DOCX soubor neobsahuje text dokumentu.");
  }

  const xml = new TextDecoder("utf-8").decode(readZipEntry(bytes, documentEntry));

  return extractTextFromDocxXml(xml);
}

// extractImportedTranscriptFromFile reads a supported transcript file into normalized text.
export async function extractImportedTranscriptFromFile(file: File) {
  const validationError = getImportedTranscriptFileValidationError(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const extension = getImportedTranscriptFileExtension(file.name);

  if (extension === "txt" || extension === "md") {
    return normalizeImportedTranscriptText(await file.text());
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  return extractTextFromDocx(bytes);
}
