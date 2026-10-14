/**
 * Bill scan field-extraction tests.
 *
 * Run: node src/lib/bill-scan.test.ts   (Node ≥ 22 strips types natively)
 */
import { extractBillFields } from "./bill-scan.ts";

let passed = 0;
let failed = 0;

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const SAMPLE = `
GEORGIA POWER
Statement Date: 10/01/2026
Account 44821-009

Amount Due: $142.37
Payment due by October 22, 2026

Previous balance $130.11
Payments -130.11
`;
eq(extractBillFields(SAMPLE).name, "GEORGIA POWER", "name from first line");
eq(extractBillFields(SAMPLE).amount, "142.37", "amount prefers labeled total");
eq(extractBillFields(SAMPLE).dueDate, "2026-10-22", "month-name due date");

const LARGEST = `
Water & Light Co
Total due $58.00
Balance $1,204.90
Due 12/05/26
`;
eq(extractBillFields(LARGEST).amount, "58.00", "labeled beats raw largest");
eq(extractBillFields(LARGEST).dueDate, "2026-12-05", "numeric MM/DD/YY date");

const EMPTY = "~~\n   \n###\n";
eq(extractBillFields(EMPTY).name, undefined, "garbage text yields no name");
eq(extractBillFields(EMPTY).amount, undefined, "garbage text yields no amount");
eq(extractBillFields(EMPTY).dueDate, undefined, "garbage text yields no due date");

const BADDATE = "Pay $9.99 by 13/45/2026";
eq(extractBillFields(BADDATE).dueDate, undefined, "impossible date rejected");
eq(extractBillFields(BADDATE).amount, "9.99", "amount still extracted");

const PHONE = "Call 555-123-4567\nTotal: 250.00\nDue 01/15/2027";
eq(extractBillFields(PHONE).amount, "250.00", "cents-required skips phone-ish runs");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
