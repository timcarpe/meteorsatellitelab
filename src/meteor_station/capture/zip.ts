/** Streaming, uncompressed ZIP32 writer; bounded memory for large CU8 recordings. */
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const flags = 0x0808; // UTF-8 filenames and a trailing data descriptor.
function header(length: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

export class CaptureZip {
  private offset = 0;
  private entries: { name: Uint8Array; size: number; crc: number; offset: number }[] = [];
  private ended = false;
  public constructor(private readonly sink: (data: Uint8Array) => Promise<void>) {}

  private async write(bytes: Uint8Array): Promise<void> {
    if (this.offset + bytes.length > 0xffffffff) throw new Error('Recording archive exceeds the ZIP32 size limit.');
    await this.sink(bytes);
    this.offset += bytes.length;
  }

  /** Entries are emitted serially; backpressure reaches the caller after each chunk. */
  public async add(name: string, chunks: AsyncIterable<Uint8Array>): Promise<void> {
    if (this.ended) throw new Error('This archive is already closed.');
    if (this.entries.length >= 65535) throw new Error('Too many files in this archive.');
    const filename = encoder.encode(name);
    if (filename.length > 65535 || name.includes('..') || name.startsWith('/'))
      throw new Error('Invalid recording filename.');
    const start = this.offset;
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, flags, true);
    local.view.setUint16(12, 0x0021, true); // DOS date: 1980-01-01; UTC times live in metadata.
    local.view.setUint16(26, filename.length, true);
    await this.write(local.bytes);
    await this.write(filename);
    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of chunks) {
      for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
      size += chunk.length;
      if (size > 0xffffffff) throw new Error('Recording file exceeds the ZIP32 size limit.');
      await this.write(chunk);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = header(16);
    descriptor.view.setUint32(0, 0x08074b50, true);
    descriptor.view.setUint32(4, crc, true);
    descriptor.view.setUint32(8, size, true);
    descriptor.view.setUint32(12, size, true);
    await this.write(descriptor.bytes);
    this.entries.push({ name: filename, size, crc, offset: start });
  }

  public async finish(): Promise<void> {
    if (this.ended) throw new Error('This archive is already closed.');
    this.ended = true;
    const start = this.offset;
    for (const entry of this.entries) {
      const central = header(46);
      central.view.setUint32(0, 0x02014b50, true);
      central.view.setUint16(4, 20, true);
      central.view.setUint16(6, 20, true);
      central.view.setUint16(8, flags, true);
      central.view.setUint16(14, 0x0021, true);
      central.view.setUint32(16, entry.crc, true);
      central.view.setUint32(20, entry.size, true);
      central.view.setUint32(24, entry.size, true);
      central.view.setUint16(28, entry.name.length, true);
      central.view.setUint32(42, entry.offset, true);
      await this.write(central.bytes);
      await this.write(entry.name);
    }
    const size = this.offset - start;
    const end = header(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(8, this.entries.length, true);
    end.view.setUint16(10, this.entries.length, true);
    end.view.setUint32(12, size, true);
    end.view.setUint32(16, start, true);
    await this.write(end.bytes);
  }
}

export async function* singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}
