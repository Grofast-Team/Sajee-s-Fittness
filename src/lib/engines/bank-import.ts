import type { SpendCategory } from '@/lib/engines/money';

/**
 * Reading a bank statement.
 *
 * The pipeline, never shortened:
 *
 *   CSV → file validation → column mapping → raw row → normalisation
 *       → duplicate detection → merchant recognition → category suggestion
 *       → preview → confirmation → the ordinary spend path
 *
 * This file is every pure step of it. Nothing here writes anything; a row
 * becomes a spend only when a person confirms it, through the same validation a
 * hand-typed spend goes through.
 *
 * ## What it will not do
 *
 * - **Guess silently.** A row it cannot read is kept and marked with the reason,
 *   not dropped: a statement that quietly loses its opening-balance line is
 *   fine, one that quietly loses a ₹40,000 transfer is not.
 * - **Invent a category.** Suggestions come from what the person has taught it,
 *   then from a short list of merchants whose category is not in doubt. Amazon
 *   sells everything, a cash withdrawal buys anything, and a name on an NEFT
 *   could be rent or a friend — those get no suggestion. There is no language
 *   model deciding what someone's money was for.
 * - **Round-trip through floats.** Amounts are parsed as digits into paise.
 */

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** RFC 4180, forgiving: quoted fields, doubled quotes, CRLF, a BOM, and ; or tab files. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.map((r) => r.map((cell) => cell.trim()));
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const [best] = [',', ';', '\t']
    .map((d) => ({ d, count: sample.split(d).length - 1 }))
    .sort((a, b) => b.count - a.count);
  return best.count > 0 ? best.d : ',';
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

export interface Mapping {
  date: number;
  description: number;
  /** Money out, when the statement splits withdrawals and deposits. */
  debit: number | null;
  credit: number | null;
  /** One signed amount column, when it does not. */
  amount: number | null;
  /** A Dr/Cr column beside a single amount. */
  type: number | null;
  dateOrder: DateOrder;
  /** For a single unsigned-or-signed amount with no type column: what a positive number means. */
  positiveIs: 'in' | 'out';
}

type Role = 'date' | 'valueDate' | 'description' | 'debit' | 'credit' | 'amount' | 'type' | 'ignore';

function roleOf(header: string): Role {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!h) return 'ignore';
  if (/^(dr ?\/ ?cr|cr ?\/ ?dr|type|transaction type|txn type|debit ?\/ ?credit)$/.test(h)) return 'type';
  if (/balance/.test(h)) return 'ignore';
  if (/withdrawal|debit|paid out|money out|\bdr\b/.test(h)) return 'debit';
  if (/deposit|credit|paid in|money in|\bcr\b/.test(h)) return 'credit';
  if (/value ?(date|dt)/.test(h)) return 'valueDate';
  if (/date|\bdt\b/.test(h)) return 'date';
  if (/narration|description|particulars|remarks|details|transaction$|merchant|payee/.test(h)) return 'description';
  if (/amount|\bamt\b/.test(h)) return 'amount';
  return 'ignore';
}

/**
 * The header row and what each column is, from the first rows of a file.
 *
 * Statements open with a preamble — the bank's name, an account number, a
 * period — so the header is searched for rather than assumed to be row one.
 */
export function findHeader(rows: string[][]): { index: number; mapping: Mapping } | null {
  for (let index = 0; index < Math.min(rows.length, 40); index++) {
    const roles = rows[index].map(roleOf);
    const first = (role: Role) => {
      const i = roles.indexOf(role);
      return i === -1 ? null : i;
    };

    const date = first('date') ?? first('valueDate');
    const description = first('description');
    const debit = first('debit');
    const credit = first('credit');
    const amount = first('amount');

    if (date === null || description === null) continue;
    if (!(debit !== null && credit !== null) && amount === null) continue;

    const split = debit !== null && credit !== null;
    const dataRows = rows.slice(index + 1, index + 60).map((r) => r[date] ?? '');

    return {
      index,
      mapping: {
        date,
        description,
        debit: split ? debit : null,
        credit: split ? credit : null,
        amount: split ? null : amount,
        type: split ? null : first('type'),
        dateOrder: detectDateOrder(dataRows),
        positiveIs: 'in',
      },
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parts(value: string): [string, string, string] | null {
  const match = value.trim().match(/^(\d{1,4})[\s/.-]+([a-z]{3,9}|\d{1,2})[\s/.-]+(\d{2,4})(?:\s.*)?$/i);
  return match ? [match[1], match[2], match[3]] : null;
}

/**
 * Day first unless a value can only be month first. A statement of
 * 01/09/2026-style dates is ambiguous throughout, and an Indian bank means the
 * first of September; one value like 09/13/2026 settles it the other way.
 */
export function detectDateOrder(values: string[]): DateOrder {
  for (const value of values) {
    const p = parts(value);
    if (!p) continue;
    if (p[0].length === 4) return 'ymd';
    if (/^\d+$/.test(p[1]) && Number(p[1]) > 12 && Number(p[0]) <= 12) return 'mdy';
    if (Number(p[0]) > 12) return 'dmy';
  }
  return 'dmy';
}

/** ISO date, or null — including for a date that does not exist. */
export function parseDate(value: string, order: DateOrder): string | null {
  const p = parts(value);
  if (!p) return null;

  let [a, b] = p;
  const c = p[2];
  let year: number;
  let month: number;
  let day: number;

  if (a.length === 4) {
    year = Number(a);
    month = monthNumber(b);
    day = Number(c);
  } else {
    if (order === 'mdy' && /^\d+$/.test(b)) [a, b] = [b, a];
    day = Number(a);
    month = monthNumber(b);
    year = c.length === 2 ? 2000 + Number(c) : Number(c);
  }

  if (!month || !day || year < 1990 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // 31 February rolls over into March in Date; refuse it instead.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function monthNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const index = MONTHS.indexOf(value.slice(0, 3).toLowerCase());
  return index === -1 ? 0 : index + 1;
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/**
 * Paise and a sign, from what a statement cell holds: "1,23,456.78", "₹250",
 * "-1,200.5", "(99.99)", "500.00 Dr", "12000,00". Null for an empty or
 * unreadable cell. Digits only — never through a float.
 */
export function parseMoney(value: string): { paise: number; negative: boolean } | null {
  let text = value.trim();
  if (!text) return null;

  let negative = false;
  if (/\bdr\.?$/i.test(text)) {
    negative = true;
    text = text.replace(/\s*dr\.?$/i, '');
  } else {
    text = text.replace(/\s*cr\.?$/i, '');
  }
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[₹\s]|inr|rs\.?/gi, '');
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  // A single comma followed by exactly two digits and no point is a decimal comma.
  if (!text.includes('.') && /^\d+,\d{2}$/.test(text)) text = text.replace(',', '.');
  text = text.replace(/,/g, '');

  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) return null;
  return { paise, negative };
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export interface NormalizedRow {
  /** Line in the file, counting from 1, so a person can find it. */
  rowNumber: number;
  cells: string[];
  occurredOn: string | null;
  description: string;
  amountPaise: number | null;
  direction: 'in' | 'out' | null;
  merchantKey: string;
  /** Why the row could not be read. Null when it could. */
  problem: string | null;
}

export function normalizeRows(rows: string[][], mapping: Mapping, firstRowNumber: number): NormalizedRow[] {
  const out: NormalizedRow[] = [];

  rows.forEach((cells, i) => {
    if (cells.every((c) => /^[\s,;.-]*$/.test(c))) return;

    const description = (cells[mapping.description] ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const occurredOn = parseDate(cells[mapping.date] ?? '', mapping.dateOrder);
    const base = {
      rowNumber: firstRowNumber + i,
      cells,
      description,
      merchantKey: merchantKey(description),
    };

    if (!occurredOn) {
      out.push({ ...base, occurredOn: null, amountPaise: null, direction: null, problem: 'No date we can read on this line.' });
      return;
    }

    let amountPaise: number | null = null;
    let direction: 'in' | 'out' | null = null;

    if (mapping.debit !== null && mapping.credit !== null) {
      const debit = parseMoney(cells[mapping.debit] ?? '');
      const credit = parseMoney(cells[mapping.credit] ?? '');
      if (debit && debit.paise > 0 && !(credit && credit.paise > 0)) {
        amountPaise = debit.paise;
        direction = 'out';
      } else if (credit && credit.paise > 0 && !(debit && debit.paise > 0)) {
        amountPaise = credit.paise;
        direction = 'in';
      }
    } else if (mapping.amount !== null) {
      const amount = parseMoney(cells[mapping.amount] ?? '');
      if (amount && amount.paise > 0) {
        amountPaise = amount.paise;
        const type = mapping.type === null ? '' : (cells[mapping.type] ?? '').trim().toLowerCase();
        if (/^d/.test(type)) direction = 'out';
        else if (/^c/.test(type)) direction = 'in';
        else if (amount.negative) direction = 'out';
        else direction = mapping.positiveIs;
      }
    }

    out.push({
      ...base,
      occurredOn,
      amountPaise,
      direction,
      problem: amountPaise === null ? 'No amount we can read on this line.' : null,
    });
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* Merchants                                                           */
/* ------------------------------------------------------------------ */

/*
 * Merchants whose category is not in doubt, and a few whose category is — with
 * null, so they are recognised as one merchant but never assigned a guess.
 * Checked as whole words against the narration, longest first.
 */
const MERCHANTS: [name: string, category: SpendCategory | null][] = [
  ['swiggy instamart', 'groceries'],
  ['swiggy', 'eating_out'],
  ['zomato', 'eating_out'],
  ['dominos', 'eating_out'],
  ['mcdonalds', 'eating_out'],
  ['kfc', 'eating_out'],
  ['starbucks', 'eating_out'],
  ['chaayos', 'eating_out'],
  ['eatsure', 'eating_out'],
  ['blinkit', 'groceries'],
  ['zepto', 'groceries'],
  ['bigbasket', 'groceries'],
  ['dmart', 'groceries'],
  ['jiomart', 'groceries'],
  ['instamart', 'groceries'],
  ['country delight', 'groceries'],
  ['milkbasket', 'groceries'],
  ['uber', 'transport'],
  ['ola', 'transport'],
  ['rapido', 'transport'],
  ['irctc', 'transport'],
  ['redbus', 'transport'],
  ['fastag', 'transport'],
  ['indian oil', 'transport'],
  ['iocl', 'transport'],
  ['hpcl', 'transport'],
  ['bpcl', 'transport'],
  ['airtel', 'phone_internet'],
  ['jio', 'phone_internet'],
  ['vodafone', 'phone_internet'],
  ['bsnl', 'phone_internet'],
  ['act fibernet', 'phone_internet'],
  ['hathway', 'phone_internet'],
  ['bescom', 'bills'],
  ['tneb', 'bills'],
  ['tangedco', 'bills'],
  ['msedcl', 'bills'],
  ['bses', 'bills'],
  ['tata power', 'bills'],
  ['adani electricity', 'bills'],
  ['indane', 'bills'],
  ['bharat gas', 'bills'],
  ['mahanagar gas', 'bills'],
  ['apollo pharmacy', 'medical'],
  ['medplus', 'medical'],
  ['pharmeasy', 'medical'],
  ['1mg', 'medical'],
  ['netmeds', 'medical'],
  ['practo', 'medical'],
  ['netflix', 'entertainment'],
  ['hotstar', 'entertainment'],
  ['spotify', 'entertainment'],
  ['bookmyshow', 'entertainment'],
  ['pvr', 'entertainment'],
  ['inox', 'entertainment'],
  ['sonyliv', 'entertainment'],
  ['zee5', 'entertainment'],
  ['myntra', 'clothes'],
  ['ajio', 'clothes'],
  ['udemy', 'education'],
  ['coursera', 'education'],
  ['urban company', 'household'],
  ['zerodha', 'savings'],
  ['groww', 'savings'],
  // Recognised, deliberately not categorised.
  ['amazon', null],
  ['flipkart', null],
  ['paytm', null],
  ['phonepe', null],
  ['google pay', null],
];

const BY_LENGTH = [...MERCHANTS].sort((a, b) => b[0].length - a[0].length);

/** Words that are how a bank writes a payment, not who it went to. */
const NOISE = new Set([
  'upi', 'dr', 'cr', 'to', 'by', 'transfer', 'trf', 'neft', 'imps', 'rtgs', 'pos', 'ach', 'nach', 'ecs', 'mandate',
  'payment', 'from', 'phone', 'mob', 'mobile', 'ref', 'txn', 'via', 'the', 'and', 'for', 'bank', 'netbank', 'inb',
  'ybl', 'ibl', 'axl', 'apl', 'upi', 'okaxis', 'oksbi', 'okicici', 'okhdfcbank', 'paytm', 'payu', 'razorpay',
  'icici', 'hdfc', 'sbi', 'axis', 'kotak', 'yesb', 'yes', 'idfc', 'indusind', 'pvt', 'ltd', 'limited', 'private',
  'india', 'services', 'commerce', 'technologies', 'mum', 'blr', 'del', 'chn', 'hyd', 'sent', 'received', 'collect',
  'request', 'purchase', 'debit', 'credit', 'card', 'vps', 'mps',
]);

/**
 * A short, stable name for who a payment went to, so "SWIGGY8@YBL" on one
 * statement and "Swiggy Ltd" on another are the same merchant, and a category
 * someone chose for it once can be applied the next time.
 */
export function merchantKey(description: string): string {
  const text = ` ${description.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

  if (/\b(atm|atw|nwd|cash wdl|atm wdl|cash withdrawal)\b/.test(text)) return 'cash withdrawal';

  for (const [name] of BY_LENGTH) {
    const word = name.replace(/[^a-z0-9]+/g, ' ');
    if (text.includes(` ${word} `) || new RegExp(`\\b${word}\\d*\\b`).test(text)) return name;
  }

  const words = description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/\d/.test(w) && !NOISE.has(w));

  return words.slice(0, 2).join(' ') || 'unknown';
}

export type LineKind = 'expense' | 'income' | 'transfer' | 'saving' | 'refund';

/** What a line can be, by which way the money moved. */
export const KINDS_FOR: Record<'in' | 'out', LineKind[]> = {
  out: ['expense', 'saving', 'transfer'],
  in: ['income', 'transfer', 'saving', 'refund'],
};

/**
 * What the person taught it for one merchant, one direction at a time: Amazon
 * out is shopping, Amazon in is a refund, and one rule cannot say both.
 */
export interface MerchantRule {
  merchantKey: string;
  direction?: 'in' | 'out';
  kind?: LineKind;
  /** For spending only. */
  category: SpendCategory | null;
  savingsGoalId?: string | null;
  incomeSourceId?: string | null;
}

export type Suggestion =
  | { category: SpendCategory; source: 'rule' | 'keyword' }
  | { category: null; source: 'none' };

/** What the person taught it first, then merchants whose category is not in doubt. Otherwise nothing. */
export function suggestCategory(key: string, rules: MerchantRule[]): Suggestion {
  const rule = rules.find(
    (r) =>
      r.merchantKey === key &&
      (r.direction ?? 'out') === 'out' &&
      (r.kind ?? 'expense') === 'expense' &&
      r.category !== null,
  );
  if (rule && rule.category) return { category: rule.category, source: 'rule' };

  const known = MERCHANTS.find(([name]) => name === key);
  if (known && known[1]) return { category: known[1], source: 'keyword' };

  return { category: null, source: 'none' };
}

/* ------------------------------------------------------------------ */
/* What a line is                                                      */
/* ------------------------------------------------------------------ */

export interface Classification {
  kind: LineKind;
  category: SpendCategory | null;
  savingsGoalId: string | null;
  incomeSourceId: string | null;
  source: 'rule' | 'keyword' | 'none';
  /** Why, in words, when a pattern decided. */
  reason: string | null;
}

/*
 * Patterns only where the answer is not in doubt, checked against the narration
 * with punctuation turned to spaces.
 */
const CARD_BILL =
  /\b(credit card|cc payment|cc bill|card bill|card autopay|autopay card|cred club|cred|sbi card|card payment)\b/;
const OWN_TRANSFER = /\b(self|to self|by self|own account|own a c|own acct|sweep in|sweep out|internal transfer)\b/;
const SAVING_OUT =
  /\b(sip|mutual fund|mf purchase|rd installment|rd instalment|recurring deposit|fixed deposit|fd booking|ppf|nps|elss|smallcase|kuvera|indmoney|zerodha|groww)\b/;
const SAVING_IN = /\b(fd closure|fd maturity|fd redemption|rd maturity|redemption|mf redemption)\b/;
const REFUND = /\b(refund|reversal|reversed|cashback|chargeback)\b/;
const SALARY = /\b(salary|sal|payroll|stipend)\b/;
const INTEREST = /\b(int pd|interest|int credit|int cr)\b/;

/**
 * What kind of money movement a line is.
 *
 * The distinction that matters most is transfer against spending. A credit
 * card bill paid from the bank moves money to the card — the spending already
 * happened, line by line, on the card statement — and a transfer to your own
 * account moves money you still have. Counting either as spending reports
 * money gone that is not.
 */
export function classifyLine(
  row: Pick<NormalizedRow, 'direction' | 'description' | 'merchantKey'>,
  rules: MerchantRule[],
): Classification {
  const direction = row.direction ?? 'out';
  const none = { category: null, savingsGoalId: null, incomeSourceId: null };

  const rule = rules.find((r) => r.merchantKey === row.merchantKey && (r.direction ?? 'out') === direction);
  if (rule && rule.kind && KINDS_FOR[direction].includes(rule.kind)) {
    return {
      kind: rule.kind,
      category: rule.kind === 'expense' ? rule.category : null,
      savingsGoalId: rule.kind === 'saving' ? (rule.savingsGoalId ?? null) : null,
      incomeSourceId: rule.kind === 'income' ? (rule.incomeSourceId ?? null) : null,
      source: 'rule',
      reason: null,
    };
  }

  const text = ` ${row.description.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

  if (CARD_BILL.test(text)) {
    return {
      ...none,
      kind: 'transfer',
      source: 'keyword',
      reason:
        direction === 'out'
          ? 'Looks like a credit card bill. The spending is on the card statement, so paying the bill is not counted again.'
          : 'Looks like money moving to or from a card.',
    };
  }
  if (OWN_TRANSFER.test(text)) {
    return { ...none, kind: 'transfer', source: 'keyword', reason: 'Looks like money moved between your own accounts.' };
  }

  if (direction === 'out') {
    if (SAVING_OUT.test(text)) {
      return { ...none, kind: 'saving', source: 'keyword', reason: 'Looks like money put into an investment or deposit.' };
    }
    const suggestion = suggestCategory(row.merchantKey, rules);
    return { ...none, kind: 'expense', category: suggestion.category, source: suggestion.source, reason: null };
  }

  if (SAVING_IN.test(text)) {
    return { ...none, kind: 'saving', source: 'keyword', reason: 'Looks like a deposit or investment paying out.' };
  }
  if (REFUND.test(text)) {
    return { ...none, kind: 'refund', source: 'keyword', reason: 'Looks like a refund. A refund is not income.' };
  }
  if (SALARY.test(text) || INTEREST.test(text)) {
    return { ...none, kind: 'income', source: 'keyword', reason: null };
  }
  // Money in with nothing to say what it is: offered as income, never assumed.
  return { ...none, kind: 'income', source: 'none', reason: null };
}

/* ------------------------------------------------------------------ */
/* Transfers                                                           */
/* ------------------------------------------------------------------ */

/** A line from an earlier import, for finding the other leg of a transfer. */
export interface OtherLine {
  id: string;
  direction: 'in' | 'out';
  amountPaise: number;
  occurredOn: string;
  kind: LineKind | null;
}

export interface TransferPair {
  /** The other leg in this file. */
  rowNumber: number | null;
  /** The other leg in an earlier import. */
  otherRowId: string | null;
}

const PAIR_DAYS = 2;

/**
 * Lines that are probably two halves of one transfer.
 *
 * Between two statements, the same amount leaving one account and arriving in
 * another within two days is the signature of moving your own money. Within
 * one file that is not enough — a friend paying back ₹500 the day you spent
 * ₹500 is ordinary — so a pair in the same file also needs one leg to read as
 * a transfer.
 */
export function pairTransfers(rows: NormalizedRow[], others: OtherLine[]): Map<number, TransferPair> {
  const pairs = new Map<number, TransferPair>();
  const usable = rows.filter((r) => !r.problem && r.amountPaise !== null && r.occurredOn && r.direction);
  const claimedOthers = new Set<string>();

  const readsAsTransfer = (r: NormalizedRow) => classifyLine(r, []).kind === 'transfer';

  for (const row of usable) {
    if (pairs.has(row.rowNumber)) continue;

    const sameFile = usable.find(
      (other) =>
        other.rowNumber !== row.rowNumber &&
        !pairs.has(other.rowNumber) &&
        other.direction !== row.direction &&
        other.amountPaise === row.amountPaise &&
        dayGap(other.occurredOn!, row.occurredOn!) <= PAIR_DAYS &&
        (readsAsTransfer(row) || readsAsTransfer(other)),
    );
    if (sameFile) {
      pairs.set(row.rowNumber, { rowNumber: sameFile.rowNumber, otherRowId: null });
      pairs.set(sameFile.rowNumber, { rowNumber: row.rowNumber, otherRowId: null });
      continue;
    }

    const earlier = others
      .filter(
        (o) =>
          !claimedOthers.has(o.id) &&
          o.direction !== row.direction &&
          o.amountPaise === row.amountPaise &&
          dayGap(o.occurredOn, row.occurredOn!) <= PAIR_DAYS,
      )
      .sort((a, b) => dayGap(a.occurredOn, row.occurredOn!) - dayGap(b.occurredOn, row.occurredOn!))[0];
    if (earlier) {
      claimedOthers.add(earlier.id);
      pairs.set(row.rowNumber, { rowNumber: null, otherRowId: earlier.id });
    }
  }

  return pairs;
}

/* ------------------------------------------------------------------ */
/* Duplicates                                                          */
/* ------------------------------------------------------------------ */

export interface ExistingSpend {
  id: string;
  spentOn: string;
  amountPaise: number;
}

export interface ExistingIncome {
  id: string;
  receivedOn: string;
  amountPaise: number;
}

export interface DuplicateMark {
  /** An earlier line of this file with the same date, amount and narration. */
  ofRow: number | null;
  /** A spend already recorded: same amount, a day either side. */
  ofSpend: string | null;
  /** Income already recorded: same amount, a day either side. */
  ofIncome: string | null;
}

const DAY_MS = 86_400_000;
const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

/**
 * Which rows are probably already recorded.
 *
 * Two cases, both common rather than rare: a statement exported twice with
 * overlapping dates, and money typed in by hand on the day and then found
 * again in the statement — often dated a day apart, since a card payment posts
 * the next day. Separate payments of the same amount carry different
 * references, so only an identical narration counts as a repeat within a file.
 * Money in is checked against income the same way: a salary typed in on payday
 * and imported a week later would otherwise be counted twice.
 */
export function markDuplicates(
  rows: NormalizedRow[],
  existing: ExistingSpend[],
  incomes: ExistingIncome[] = [],
): Map<number, DuplicateMark> {
  const marks = new Map<number, DuplicateMark>();
  const seen = new Map<string, number>();
  const claimed = new Set<string>();

  function closest<T extends { id: string; amountPaise: number }>(list: T[], date: (x: T) => string, row: NormalizedRow) {
    return list
      .filter((x) => !claimed.has(x.id) && x.amountPaise === row.amountPaise && dayGap(date(x), row.occurredOn!) <= 1)
      .sort((a, b) => dayGap(date(a), row.occurredOn!) - dayGap(date(b), row.occurredOn!))[0];
  }

  for (const row of rows) {
    if (row.problem || row.amountPaise === null || !row.occurredOn) continue;

    const signature = `${row.occurredOn}|${row.amountPaise}|${row.direction}|${row.description.toLowerCase()}`;
    const earlier = seen.get(signature);
    if (earlier !== undefined) {
      marks.set(row.rowNumber, { ofRow: earlier, ofSpend: null, ofIncome: null });
      continue;
    }
    seen.set(signature, row.rowNumber);

    if (row.direction === 'out') {
      const match = closest(existing, (s) => s.spentOn, row);
      if (match) {
        claimed.add(match.id);
        marks.set(row.rowNumber, { ofRow: null, ofSpend: match.id, ofIncome: null });
      }
    } else {
      const match = closest(incomes, (i) => i.receivedOn, row);
      if (match) {
        claimed.add(match.id);
        marks.set(row.rowNumber, { ofRow: null, ofSpend: null, ofIncome: match.id });
      }
    }
  }

  return marks;
}
