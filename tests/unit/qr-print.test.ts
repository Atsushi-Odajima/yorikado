import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { generateToken, normalizeTokenInput, qrText } from '@/domain/vouchers/token';

async function decodePng(png: Buffer): Promise<string> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = new Uint8ClampedArray(info.width * info.height);
  for (let i = 0; i < lum.length; i++) lum[i] = data[i * 4]!;
  const src = new RGBLuminanceSource(lum, info.width, info.height);
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(src))).getText();
}

describe('printed QR (same settings as the print sheet)', () => {
  it('encodes YK1:<token> and decodes back with ZXing at print size', async () => {
    for (let i = 0; i < 5; i++) {
      const t = generateToken();
      // 30mm at 300dpi ≈ 354px; also a coarse 120px render
      for (const width of [354, 120]) {
        const png = await QRCode.toBuffer(qrText(t), { errorCorrectionLevel: 'M', margin: 2, width });
        const text = await decodePng(png);
        expect(normalizeTokenInput(text)).toBe(t);
      }
    }
  });
});
