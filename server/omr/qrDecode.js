const sharp = require('sharp');
const jsQR = require('jsqr');

// Read the student-ID QR from a sheet image. Retries with upscaling because the
// QR is small relative to the full frame. Returns the string, or null.
async function decodeStudentQR(imageBuffer) {
  const attempts = [
    (img) => img,
    (img) => img.resize(1600, null),
    (img) => img.resize(1200, null).sharpen(),
  ];

  for (const transform of attempts) {
    try {
      const { data, info } = await transform(sharp(imageBuffer).rotate())
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      if (code && code.data && code.data.trim()) return code.data.trim();
    } catch {
      // try next transform
    }
  }
  return null;
}

module.exports = { decodeStudentQR };
