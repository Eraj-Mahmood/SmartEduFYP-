const crypto = require("crypto");

// Temporary passwords (admin-created accounts and admin resets): cryptographically random, 12
// characters, always with an upper-case letter, a lower-case letter and a digit, so they pass the
// change-password rules. No look-alike characters (0/O, 1/l/I) - they are read out or copied by hand.

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;
const LENGTH = 12;

const pick = (set) => set[crypto.randomInt(set.length)];

function temporaryPassword() {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < LENGTH) chars.push(pick(ALL));
  // Fisher-Yates with crypto randomness, so the guaranteed characters aren't always first
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

module.exports = { temporaryPassword };
