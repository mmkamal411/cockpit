/**
 * Unit tests for src/lib/chat/mode.ts — Crystal Chat mode routing.
 * Run: node src/lib/chat/mode.test.ts   (Node ≥ 22 strips types natively)
 */
import {
  detectPersona,
  stripDirective,
  flipConfirmation,
} from "./mode.js";

let passed = 0;
let failed = 0;

function eq(actual: unknown, expected: unknown, name: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

console.log("detectPersona — fireball triggers");
eq(detectPersona("fireball, why is my spending up?"), "fireball", "leading fireball");
eq(detectPersona("ask fireball to be blunt"), "fireball", "mid-sentence fireball");
eq(detectPersona("FIREBALL MODE"), "fireball", "case-insensitive fireball");

console.log("detectPersona — crystal / expansion triggers");
eq(detectPersona("explain this to me"), "crystal", "explain -> crystal");
eq(detectPersona("help me plan my week"), "crystal", "plan -> crystal");
eq(detectPersona("more details please"), "crystal", "more/details -> crystal");
eq(detectPersona("describe the process"), "crystal", "describe -> crystal");
eq(detectPersona("create a to-do for that"), "crystal", "create -> crystal");
eq(detectPersona("hey crystal, what should I focus on?"), "crystal", "explicit crystal");

console.log("detectPersona — defaults and conflicts");
eq(detectPersona("hello there"), "crystal", "no keywords defaults to crystal");
eq(detectPersona("fireball crystal explain"), "fireball", "explicit fireball wins over crystal");
eq(detectPersona("fireballs are hot"), "crystal", "word boundary: fireballs is not fireball");

console.log("stripDirective");
eq(stripDirective("fireball, why is spending up?", "fireball"), "why is spending up?", "strips leading fireball,");
eq(stripDirective("hey crystal, help me plan", "crystal"), "help me plan", "strips 'hey crystal,'");
eq(stripDirective("the fireball exploded", "fireball"), "the fireball exploded", "mid-sentence kept");
eq(stripDirective("fireball", "fireball"), "fireball", "never strips to empty");

console.log("flipConfirmation");
eq(flipConfirmation("fireball"), "Switched to Fireball — direct, numbers-first, no softening.", "fireball note");
eq(flipConfirmation("crystal"), "Switched to Crystal — warm and steady.", "crystal note");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
