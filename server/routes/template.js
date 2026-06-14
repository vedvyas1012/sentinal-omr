const express = require('express');
const QRCode = require('qrcode');
const { COL_CENTERS, ROW_START, ROW_STEP } = require('../omr/gridAnalyzer');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const router = express.Router();

const OPTIONS = ['A', 'B', 'C', 'D', 'E'];
const NUM_Q = 10;
const BUBBLE_R = 18;

const BUBBLES = (() => {
  const out = [];
  for (let q = 0; q < NUM_Q; q++) {
    for (let o = 0; o < OPTIONS.length; o++) {
      out.push({ id: `b-${q + 1}-${OPTIONS[o]}`, cx: COL_CENTERS[o], cy: ROW_START + q * ROW_STEP });
    }
  }
  return out;
})();

const BUBBLE_CSS = BUBBLES.map(({ id, cx, cy }) =>
  `#${id}{left:${cx - BUBBLE_R}px;top:${cy - BUBBLE_R}px}`
).join('');

const BUBBLE_HTML = BUBBLES.map(({ id }) => `<div id="${id}" class="b"></div>`).join('');

const Q_LABELS = Array.from({ length: NUM_Q }, (_, i) => {
  const cy = ROW_START + i * ROW_STEP;
  return `<div style="position:absolute;left:30px;top:${cy - 11}px;font-size:14px;font-weight:700;color:#374151">Q${i + 1}</div>`;
}).join('');

const COL_HEADERS = OPTIONS.map((opt, o) => {
  const cx = COL_CENTERS[o];
  return `<div style="position:absolute;left:${cx - 10}px;top:185px;font-size:13px;font-weight:700;color:#1e3a8a;width:20px;text-align:center">${opt}</div>`;
}).join('');

const ROW_DIVIDERS = Array.from({ length: NUM_Q - 1 }, (_, i) => {
  const y = ROW_START + (i + 1) * ROW_STEP - ROW_STEP / 2;
  return `<div style="position:absolute;left:100px;right:30px;top:${Math.round(y)}px;height:1px;background:#f3f4f6"></div>`;
}).join('');

router.get('/', async (req, res) => {
  const rawId = req.query.studentId;
  const studentId = rawId ? String(rawId).slice(0, 100) : '';
  const safeId = escapeHtml(studentId);

  let qrSrc = '';
  if (studentId) {
    qrSrc = await QRCode.toDataURL(studentId, { width: 152, margin: 1, color: { dark: '#000', light: '#fff' } });
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>NEET OMR${safeId ? ' — ' + safeId : ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#f3f4f6}
.sheet{width:800px;height:1000px;position:relative;background:#fff;border:2px solid #000;margin:0 auto}
.b{position:absolute;width:${BUBBLE_R * 2}px;height:${BUBBLE_R * 2}px;border-radius:50%;border:2.5px solid #374151;background:transparent}
${BUBBLE_CSS}
.toolbar{padding:12px 16px;background:#eff6ff;border-bottom:2px solid #3b82f6;display:flex;align-items:center;justify-content:space-between;gap:12px}
.toolbar strong{font-size:15px;color:#1e3a8a}
.toolbar p{font-size:12px;color:#4b5563;margin-top:2px}
.btn{background:#1d4ed8;color:#fff;border:none;padding:9px 20px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;white-space:nowrap}
.btn:hover{background:#1e40af}
@media print{.toolbar{display:none}.sheet{border:1px solid #000;margin:0}}
</style>
</head>
<body>
<div class="toolbar">
  <div>
    <strong>NEET Secure OMR Sheet${safeId ? ' — Student ' + safeId : ''}</strong>
    <p>Print this page · Student fills bubbles with dark pen · Invigilator scans QR + photo to auto-record</p>
  </div>
  <button class="btn" onclick="window.print()">Print Sheet</button>
</div>

<div class="sheet">

  <div style="position:absolute;left:0;top:0;right:0;height:170px;background:#1e3a8a">
    <div style="position:absolute;left:24px;top:0;right:180px;height:170px;display:flex;flex-direction:column;justify-content:center">
      <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:3px">NEET SECURE OMR</div>
      <div style="color:#bfdbfe;font-size:12px;margin-top:5px;letter-spacing:1px">ANSWER SHEET &middot; NATIONAL ELIGIBILITY CUM ENTRANCE TEST</div>
      ${safeId ? `<div style="color:#fbbf24;font-size:16px;font-weight:700;margin-top:10px">STUDENT ID: ${safeId}</div>` : ''}
    </div>
    <div style="position:absolute;right:14px;top:9px;background:#fff;padding:4px;border-radius:4px">
      ${qrSrc
        ? `<img src="${qrSrc}" style="width:152px;height:152px;display:block" alt="QR code for student ${safeId}">`
        : `<div style="width:152px;height:152px;border:1px dashed #9ca3af;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;text-align:center;padding:8px">QR auto-generated<br>add ?studentId= to URL</div>`
      }
      <div style="font-size:9px;color:#6b7280;text-align:center;margin-top:2px">SCAN FOR STUDENT ID</div>
    </div>
  </div>

  ${COL_HEADERS}
  ${Q_LABELS}
  <div style="position:absolute;left:100px;right:30px;top:208px;height:1px;background:#d1d5db"></div>
  ${BUBBLE_HTML}
  ${ROW_DIVIDERS}

  <div style="position:absolute;bottom:0;left:0;right:0;height:44px;background:#f8fafc;border-top:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center">
    <span style="font-size:11px;color:#6b7280">Use dark blue or black pen &middot; Fill bubble completely &middot; One answer per question &middot; Do not use white-out</span>
  </div>

</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
