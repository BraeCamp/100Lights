export interface LutData {
  size: number;
  table: Float32Array;
  title?: string;
}

export function parseCube(text: string): LutData {
  let size = 0;
  let title: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      title = line.slice(5).trim().replace(/^"|"$/g, '');
    } else if (upper.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.slice(11).trim(), 10);
      if (!Number.isFinite(size) || size < 2 || size > 256) {
        throw new Error(`Invalid LUT_3D_SIZE: "${line}"`);
      }
    } else if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('Only 3D LUTs are supported; found LUT_1D_SIZE');
    } else if (upper.startsWith('DOMAIN_MIN') || upper.startsWith('DOMAIN_MAX')) {
      // accepted, domain remapping not applied (assumed [0,1])
    } else if (/^[+\-]?[\d.]/.test(line)) {
      dataLines.push(line);
    }
  }

  if (size === 0) throw new Error('Missing LUT_3D_SIZE header');

  const expectedEntries = size * size * size;
  if (dataLines.length < expectedEntries) {
    throw new Error(
      `Expected ${expectedEntries} data entries but found ${dataLines.length}`
    );
  }

  const table = new Float32Array(expectedEntries * 3);

  for (let i = 0; i < expectedEntries; i++) {
    const parts = dataLines[i].split(/\s+/);
    if (parts.length < 3) {
      throw new Error(`Invalid data at entry ${i}: "${dataLines[i]}"`);
    }
    // .cube ordering: R fastest, B slowest — remap to R-major indexing
    const r = i % size;
    const g = (i / size | 0) % size;
    const b = (i / (size * size)) | 0;
    const idx = (r * size * size + g * size + b) * 3;
    table[idx]     = +parts[0];
    table[idx + 1] = +parts[1];
    table[idx + 2] = +parts[2];
  }

  return { size, table, title };
}

export function applyLutToCanvas(
  ctx: CanvasRenderingContext2D,
  lut: LutData,
  w: number,
  h: number
): void {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const { size, table } = lut;
  const s1 = size - 1;
  const s2 = size * size;

  for (let i = 0; i < data.length; i += 4) {
    const rp = (data[i]     / 255) * s1;
    const gp = (data[i + 1] / 255) * s1;
    const bp = (data[i + 2] / 255) * s1;

    const r0 = rp | 0;
    const g0 = gp | 0;
    const b0 = bp | 0;
    const r1 = r0 < s1 ? r0 + 1 : s1;
    const g1 = g0 < s1 ? g0 + 1 : s1;
    const b1 = b0 < s1 ? b0 + 1 : s1;

    const rf = rp - r0;
    const gf = gp - g0;
    const bf = bp - b0;

    const i000 = (r0 * s2 + g0 * size + b0) * 3;
    const i100 = (r1 * s2 + g0 * size + b0) * 3;
    const i010 = (r0 * s2 + g1 * size + b0) * 3;
    const i110 = (r1 * s2 + g1 * size + b0) * 3;
    const i001 = (r0 * s2 + g0 * size + b1) * 3;
    const i101 = (r1 * s2 + g0 * size + b1) * 3;
    const i011 = (r0 * s2 + g1 * size + b1) * 3;
    const i111 = (r1 * s2 + g1 * size + b1) * 3;

    for (let c = 0; c < 3; c++) {
      const v00 = table[i000 + c] + rf * (table[i100 + c] - table[i000 + c]);
      const v01 = table[i001 + c] + rf * (table[i101 + c] - table[i001 + c]);
      const v10 = table[i010 + c] + rf * (table[i110 + c] - table[i010 + c]);
      const v11 = table[i011 + c] + rf * (table[i111 + c] - table[i011 + c]);
      const v0  = v00 + gf * (v10 - v00);
      const v1  = v01 + gf * (v11 - v01);
      data[i + c] = ((v0 + bf * (v1 - v0)) * 255 + 0.5) | 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
