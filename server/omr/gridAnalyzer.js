const sharp = require('sharp');

const NORM_W = 800;
const NORM_H = 1000;
const OPTIONS = ['A', 'B', 'C', 'D', 'E'];
const NUM_Q = 10;

// Bubble coordinates in the normalized canvas — must match template.js exactly.
const COL_CENTERS = [190, 300, 410, 520, 630];
const ROW_START = 220;
const ROW_STEP = 72;
const SAMPLE_R = 30;

// Confidence scales: a reading is confident when the chosen bubble is both
// clearly dark and clearly darker than the next-darkest option.
const MARGIN_SCALE = 40; // separation from the runner-up bubble
const DARK_SCALE = 80;   // absolute darkness of the chosen bubble

// Returns { answers, confidence } where confidence[q] is 0..1.
async function analyzeGridDetailed(imageBuffer) {
  const { data } = await sharp(imageBuffer)
    .resize(NORM_W, NORM_H, { fit: 'cover', position: 'centre' })
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  function avgBrightness(cx, cy) {
    let sum = 0;
    let count = 0;
    for (let dy = -SAMPLE_R; dy <= SAMPLE_R; dy++) {
      for (let dx = -SAMPLE_R; dx <= SAMPLE_R; dx++) {
        if (dx * dx + dy * dy <= SAMPLE_R * SAMPLE_R) {
          const px = Math.round(cx + dx);
          const py = Math.round(cy + dy);
          if (px >= 0 && px < NORM_W && py >= 0 && py < NORM_H) {
            sum += data[py * NORM_W + px];
            count++;
          }
        }
      }
    }
    return count > 0 ? sum / count : 255;
  }

  const answers = {};
  const confidence = {};

  for (let q = 0; q < NUM_Q; q++) {
    const cy = ROW_START + q * ROW_STEP;
    const brightness = OPTIONS.map((_, o) => avgBrightness(COL_CENTERS[o], cy));

    let minVal = Infinity;
    let chosen = 0;
    for (let o = 0; o < OPTIONS.length; o++) {
      if (brightness[o] < minVal) { minVal = brightness[o]; chosen = o; }
    }
    let secondVal = Infinity;
    for (let o = 0; o < OPTIONS.length; o++) {
      if (o !== chosen && brightness[o] < secondVal) secondVal = brightness[o];
    }

    const margin = secondVal - minVal; // darker chosen vs runner-up
    const darkness = 255 - minVal;     // how filled the chosen bubble is
    const conf = Math.max(0, Math.min(1, Math.min(margin / MARGIN_SCALE, darkness / DARK_SCALE)));

    answers[`Q${q + 1}`] = OPTIONS[chosen];
    confidence[`Q${q + 1}`] = Math.round(conf * 100) / 100;
  }

  return { answers, confidence };
}

async function analyzeGrid(imageBuffer) {
  return (await analyzeGridDetailed(imageBuffer)).answers;
}

module.exports = {
  analyzeGrid,
  analyzeGridDetailed,
  COL_CENTERS, ROW_START, ROW_STEP, NORM_W, NORM_H,
};
