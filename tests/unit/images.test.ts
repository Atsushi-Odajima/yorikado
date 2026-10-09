import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sniffImage } from '@/domain/requests/attachments';
import { processImage } from '@/server/storage/images';

describe('image sanitising', () => {
  it('re-encodes, strips EXIF/GPS and limits the long edge', async () => {
    const src = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#264D3C' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'x' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(src).metadata()).exif).toBeTruthy();
    const out = await processImage(src);
    const meta = await sharp(out.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBe(2400);
    expect(out.format).toBe('jpeg');
  });

  it('rejects MIME spoofing, SVG/HTML and broken images', async () => {
    await expect(processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow();
    await expect(processImage(Buffer.from('<html><script>alert(1)</script></html>'))).rejects.toThrow();
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    await expect(processImage(png.subarray(0, 40))).rejects.toThrow();
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
  });

  it('rejects oversized input', async () => {
    await expect(processImage(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow(/10MB/);
  });
});
