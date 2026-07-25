// Ad-hoc checks for validatePinStrength. Run with: npx tsx scripts/test_pin_strength.ts
// Not wired into a test framework on purpose — it just prints PASS/FAIL per case
// and exits non-zero if any case fails.
import { validatePinStrength } from "../server/routes_auth";

const shouldPass = ["529174", "8471362", "13579246"];
const shouldReject = [
  "123456", "654321", "111111", "121212", "123123", "112233",
  "987654", "01234567", "98765432", "123", "12345", "1234abcd", "12345678901",
];

let failures = 0;

for (const pin of shouldPass) {
  const err = validatePinStrength(pin);
  const ok = err === null;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  accept ${JSON.stringify(pin)}${ok ? "" : ` → got: ${err}`}`);
}

for (const pin of shouldReject) {
  const err = validatePinStrength(pin);
  const ok = err !== null;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  reject ${JSON.stringify(pin)}${ok ? ` → ${err}` : " → wrongly accepted"}`);
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
