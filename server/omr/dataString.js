const crypto = require('crypto');

// Edge and hub must both call this so identical marks produce an identical
// string — that equality is the basis of the tamper-detection hash check.
function buildDataString(studentId, answers) {
  const sortedKeys = Object.keys(answers).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10);
    const numB = parseInt(b.replace(/\D/g, ''), 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
  return [`ID:${studentId}`, ...sortedKeys.map(k => `${k}:${answers[k]}`)].join('|');
}

function hashDataString(dataString) {
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

// Inverse of buildDataString: "ID:492|Q1:A|Q2:B" → { studentId, answers }
function parseDataString(dataString) {
  const answers = {};
  let studentId = '';
  for (const part of String(dataString).split('|')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const key = part.slice(0, idx);
    const val = part.slice(idx + 1);
    if (key === 'ID') studentId = val;
    else answers[key] = val;
  }
  return { studentId, answers };
}

module.exports = { buildDataString, hashDataString, parseDataString };
