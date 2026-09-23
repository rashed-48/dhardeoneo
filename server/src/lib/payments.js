import crypto from 'node:crypto';

/**
 * Simulated card gateway.
 *
 * This is NOT a real payment processor — no money moves and no card data leaves
 * this process. It exists so the whole money flow (authorise, capture, refund,
 * payout) is modelled end to end with the same shape a real provider returns.
 *
 * To go live, replace `charge` and `refund` with calls to a PSP (Stripe,
 * SSLCOMMERZ, bKash) and keep the return shape. Nothing above this file
 * touches card numbers: the route hands them straight here and only the brand
 * and last four digits are ever persisted. A real integration would not send
 * the PAN to this server at all — the client would tokenise it first.
 */

const reference = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('hex')}`;

const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

/** Standard checksum every card number satisfies. */
export function luhnValid(number) {
  const digits = digitsOnly(number);
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function cardBrand(number) {
  const d = digitsOnly(number);
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^6(?:011|5)/.test(d)) return 'Discover';
  return 'Card';
}

function expiryValid(month, year) {
  const m = Number(month);
  let y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(y)) return false;
  if (y < 100) y += 2000;
  const now = new Date();
  const endOfMonth = new Date(Date.UTC(y, m, 1));
  return endOfMonth > now;
}

/**
 * Test cards, so the failure paths are reachable without a sandbox account:
 *   4242 4242 4242 4242  -> succeeds
 *   4000 0000 0000 0002  -> declined by issuer
 *   4000 0000 0009 0003  -> insufficient funds
 *
 * The rule is the last four digits, but every test number still has to pass
 * the Luhn check first, exactly as a real card would.
 */
function simulateOutcome(digits) {
  if (digits.endsWith('0002')) return { ok: false, reason: 'Your bank declined this card.' };
  if (digits.endsWith('0003')) return { ok: false, reason: 'Insufficient funds.' };
  return { ok: true, reason: '' };
}

/**
 * @returns {{ok: boolean, reference: string, brand: string, last4: string, failureReason: string}}
 */
export function charge({ number, expMonth, expYear, cvc, amount }) {
  const digits = digitsOnly(number);
  const brand = cardBrand(digits);
  const last4 = digits.slice(-4);
  const fail = (failureReason) => ({ ok: false, reference: reference('ch'), brand, last4, failureReason });

  if (!luhnValid(digits)) return fail('That card number is not valid.');
  if (!expiryValid(expMonth, expYear)) return fail('That expiry date has passed.');

  const cvcDigits = digitsOnly(cvc);
  const cvcLength = brand === 'Amex' ? 4 : 3;
  if (cvcDigits.length !== cvcLength) return fail(`The security code should be ${cvcLength} digits.`);

  if (!Number.isInteger(amount) || amount <= 0) return fail('Nothing to charge.');

  const outcome = simulateOutcome(digits);
  if (!outcome.ok) return fail(outcome.reason);

  return { ok: true, reference: reference('ch'), brand, last4, failureReason: '' };
}

/** Refunds always succeed here; a real PSP can fail these too. */
export function refund({ amount }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reference: '', failureReason: 'Nothing to refund.' };
  }
  return { ok: true, reference: reference('re'), failureReason: '' };
}

/** Moves the lender's share out of the platform balance. */
export function payout({ amount }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reference: '', failureReason: 'Nothing to pay out.' };
  }
  return { ok: true, reference: reference('po'), failureReason: '' };
}
