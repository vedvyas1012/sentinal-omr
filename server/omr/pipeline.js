const { buildDataString, hashDataString } = require('./dataString');
const { signData } = require('../crypto/signing');

// Build a signed edge record from detected answers. The Ed25519 signature over
// the data string is what makes the record tamper-evident and verifiable later
// at the hub, independent of trusting the database.
function buildEdgeRecord(studentId, answers) {
  const dataString = buildDataString(studentId, answers);
  const edgeHash = hashDataString(dataString);
  const signature = signData(dataString);
  return { studentId, dataString, edgeHash, signature };
}

module.exports = { buildEdgeRecord };
