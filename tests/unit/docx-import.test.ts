import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractImportedTranscriptFromFile } from "@/lib/transcripts/import-file";

// docx wraps a bounded XML fixture in the ZIP layout consumed by the importer.
function docx(xml: string, compressed = true) {
  const name = Buffer.from("word/document.xml");
  const raw = Buffer.from(xml);
  const data = compressed ? deflateRawSync(raw) : raw;
  let crc = 0xffffffff;
  for (const byte of raw) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return new File([Buffer.concat([local, name, data, central, name, end])], "audit.docx");
}

describe("DOCX transcript parsing", () => {
  it.each([true, false])("preserves text runs, entities and breaks (compressed=%s)", async (compressed) => {
    const xml = '<w:document><w:p><w:r><w:t xml:space="preserve"> A &amp; &lt;B&gt; </w:t><w:tab/><w:t>C</w:t><w:br/></w:r></w:p><w:p><w:r><w:t>D</w:t></w:r></w:p></w:document>';
    await expect(extractImportedTranscriptFromFile(docx(xml, compressed))).resolves.toBe("A & <B> \tC\n\nD");
  });

  it("rejects the small compressed repeated-unclosed-text regression", async () => {
    const file = docx("<w:t>".repeat(32_000));
    expect(file.size).toBeLessThan(500);
    await expect(extractImportedTranscriptFromFile(file)).rejects.toThrow("DOCX");
  });

  it.each(["<w:t>unfinished", "<w:t", "<w:t>a<w:tab/></w:t>"])("rejects malformed text: %s", async (xml) => {
    await expect(extractImportedTranscriptFromFile(docx(xml))).rejects.toThrow("DOCX");
  });

  it("does not resolve external entities or treat escaped tags as markup", async () => {
    await expect(extractImportedTranscriptFromFile(docx('<w:t>&external; &lt;w:t&gt;</w:t>'))).resolves.toBe("&external; <w:t>");
  });
});
