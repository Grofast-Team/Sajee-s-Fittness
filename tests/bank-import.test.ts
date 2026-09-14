import { describe, expect, it } from 'vitest';
import {
  classifyLine,
  detectDateOrder,
  findHeader,
  markDuplicates,
  merchantKey,
  normalizeRows,
  pairTransfers,
  parseCsv,
  parseDate,
  parseMoney,
  suggestCategory,
  type Mapping,
  type NormalizedRow,
} from '@/lib/engines/bank-import';

describe('reading the file', () => {
  it('handles quotes, escaped quotes, commas inside fields and CRLF', () => {
    const rows = parseCsv('﻿Date,Narration,Amount\r\n01/09/2026,"SWIGGY, BLR ""ORDER""",250.00\r\n');
    expect(rows).toEqual([
      ['Date', 'Narration', 'Amount'],
      ['01/09/2026', 'SWIGGY, BLR "ORDER"', '250.00'],
    ]);
  });

  it('detects a semicolon-separated file', () => {
    expect(parseCsv('Date;Description;Amount\n01.09.2026;Rent;-12000,00')[1]).toEqual([
      '01.09.2026',
      'Rent',
      '-12000,00',
    ]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('a,b\n"one\ntwo",3')[1]).toEqual(['one\ntwo', '3']);
  });
});

describe('finding the columns', () => {
  /** HDFC-style: a preamble, then withdrawal and deposit columns. */
  const hdfc = parseCsv(
    [
      'HDFC BANK Ltd.,,,,,,',
      'Account No :,50100123456789,,,,,',
      ',,,,,,',
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/09/26,UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-424512345678-PAYMENT,0000424512345678,01/09/26,250.00,,45750.00',
      '01/09/26,NEFT CR-HDFC0000001-ACME PAYROLL-SALARY SEP,N244123456,01/09/26,,50000.00,95750.00',
    ].join('\n'),
  );

  it('skips a statement preamble to the real header', () => {
    const header = findHeader(hdfc)!;
    expect(header.index).toBe(3);
    expect(header.mapping).toMatchObject({ date: 0, description: 1, debit: 4, credit: 5, amount: null });
  });

  it('prefers the transaction date to the value date', () => {
    const sbi = parseCsv('Value Date,Txn Date,Description,Ref No./Cheque No.,Debit,Credit,Balance\n');
    expect(findHeader(sbi)!.mapping).toMatchObject({ date: 1, description: 2, debit: 4, credit: 5 });
  });

  it('finds a single amount column with a type column', () => {
    const rows = parseCsv('Transaction Date,Details,Amount,Dr/Cr\n');
    expect(findHeader(rows)!.mapping).toMatchObject({ date: 0, description: 1, amount: 2, type: 3 });
  });

  it('returns nothing for a file that is not a statement', () => {
    expect(findHeader(parseCsv('name,email\nA,a@b.c'))).toBeNull();
  });
});

describe('dates', () => {
  it('reads Indian day-first dates in the usual shapes', () => {
    expect(parseDate('01/09/2026', 'dmy')).toBe('2026-09-01');
    expect(parseDate('1-9-26', 'dmy')).toBe('2026-09-01');
    expect(parseDate('01 Sep 2026', 'dmy')).toBe('2026-09-01');
    expect(parseDate('01-SEP-26', 'dmy')).toBe('2026-09-01');
    expect(parseDate('2026-09-01', 'dmy')).toBe('2026-09-01');
  });

  it('refuses a date that does not exist rather than rolling it over', () => {
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('Opening balance', 'dmy')).toBeNull();
  });

  it('works out the order from values that can only be one way', () => {
    expect(detectDateOrder(['09/13/2026', '09/01/2026'])).toBe('mdy');
    expect(detectDateOrder(['13/09/2026', '01/09/2026'])).toBe('dmy');
    // Ambiguous throughout: day first, as Indian banks write it.
    expect(detectDateOrder(['01/09/2026', '02/09/2026'])).toBe('dmy');
  });
});

describe('amounts', () => {
  it('reads what statements actually contain, exactly', () => {
    expect(parseMoney('1,23,456.78')).toEqual({ paise: 12_345_678, negative: false });
    expect(parseMoney('₹250')).toEqual({ paise: 25_000, negative: false });
    expect(parseMoney('-1,200.5')).toEqual({ paise: 120_050, negative: true });
    expect(parseMoney('(99.99)')).toEqual({ paise: 9_999, negative: true });
    expect(parseMoney('500.00 Dr')).toEqual({ paise: 50_000, negative: true });
    expect(parseMoney('500.00 CR')).toEqual({ paise: 50_000, negative: false });
    expect(parseMoney('12000,00')).toEqual({ paise: 1_200_000, negative: false });
  });

  it('treats an empty cell as no amount, and nonsense as unreadable', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('  ')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
  });
});

describe('normalising rows', () => {
  const split: Mapping = {
    date: 0, description: 1, debit: 2, credit: 3, amount: null, type: null, dateOrder: 'dmy', positiveIs: 'in',
  };

  it('reads debit and credit columns as out and in', () => {
    const rows = normalizeRows(
      [
        ['01/09/2026', 'SWIGGY', '250.00', ''],
        ['01/09/2026', 'SALARY', '', '50,000.00'],
      ],
      split,
      5,
    );
    expect(rows.map((r) => [r.rowNumber, r.direction, r.amountPaise, r.occurredOn])).toEqual([
      [5, 'out', 25_000, '2026-09-01'],
      [6, 'in', 5_000_000, '2026-09-01'],
    ]);
  });

  it('marks a row it cannot read, and says why, instead of dropping it', () => {
    const [row] = normalizeRows([['Opening Balance', '', '', '45,000.00']], split, 1);
    expect(row.problem).toMatch(/date/i);
    expect(row.amountPaise).toBeNull();
  });

  it('skips rows that are entirely empty', () => {
    expect(normalizeRows([['', '', '', ''], [',']], split, 1)).toHaveLength(0);
  });

  it('uses the sign of a single amount column, as chosen', () => {
    const single: Mapping = { ...split, debit: null, credit: null, amount: 2 };
    const rows = normalizeRows([['01/09/2026', 'A', '-100'], ['01/09/2026', 'B', '100']], single, 1);
    expect(rows.map((r) => r.direction)).toEqual(['out', 'in']);
    const card = normalizeRows([['01/09/2026', 'B', '100']], { ...single, positiveIs: 'out' }, 1);
    expect(card[0].direction).toBe('out');
  });

  it('lets a Dr/Cr column decide', () => {
    const typed: Mapping = { ...split, debit: null, credit: null, amount: 2, type: 3 };
    const rows = normalizeRows([['01/09/2026', 'A', '100', 'DR'], ['01/09/2026', 'B', '100', 'Cr']], typed, 1);
    expect(rows.map((r) => r.direction)).toEqual(['out', 'in']);
  });
});

describe('merchants and categories', () => {
  it('pulls the merchant out of UPI, POS, NEFT and ATM narrations', () => {
    expect(merchantKey('UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-424512345678-PAYMENT')).toBe('swiggy');
    expect(merchantKey('TO TRANSFER-UPI/DR/412345678901/ZOMATO L/YESB/zomato.payu/Payment fro')).toBe('zomato');
    expect(merchantKey('POS 512345XXXXXX1234 DMART AVENUE SUP')).toBe('dmart');
    expect(merchantKey('NEFT DR-HDFC0000001-RAVI KUMAR LANDLORD-NETBANK, MUM-N123456789')).toBe('ravi kumar');
    expect(merchantKey('ATW-512345XXXXXX1234-S1ANMU12-MUMBAI')).toBe('cash withdrawal');
    expect(merchantKey('UPI/412345678901/Payment from Ph/sharma.kirana@okaxis/ICICI Bank')).toBe('sharma kirana');
  });

  it('is the same key however the bank formats the same merchant', () => {
    expect(merchantKey('UPI/DR/1/BLINKIT/YESB')).toBe(merchantKey('UPI-BLINKIT COMMERCE-blinkit@hdfc-HDFC-2-UPI'));
  });

  it('prefers what the person taught it over the built-in names', () => {
    expect(suggestCategory('swiggy', [])).toEqual({ category: 'eating_out', source: 'keyword' });
    expect(suggestCategory('swiggy', [{ merchantKey: 'swiggy', category: 'groceries' }])).toEqual({
      category: 'groceries',
      source: 'rule',
    });
  });

  it('does not guess at a merchant that sells everything', () => {
    expect(suggestCategory('amazon', [])).toEqual({ category: null, source: 'none' });
    expect(suggestCategory('cash withdrawal', [])).toEqual({ category: null, source: 'none' });
    expect(suggestCategory('ravi kumar', [])).toEqual({ category: null, source: 'none' });
  });
});

describe('a whole statement', () => {
  /* The statement the end-to-end check uploads, so its expected numbers are proven here. */
  const statement = [
    'HDFC BANK Ltd.,,,,,,',
    'Statement of account,,,,,,',
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '01/09/26,NEFT CR-HDFC0000001-ACME PAYROLL-SALARY SEP,N244123456,01/09/26,,"50,000.00","95,750.00"',
    '02/09/26,UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-424512345678-PAYMENT,0000424512345678,02/09/26,250.00,,"95,500.00"',
    '03/09/26,POS 512345XXXXXX1234 DMART AVENUE SUP,0000000000000001,03/09/26,"1,840.50",,"93,659.50"',
    '04/09/26,UPI/412345678901/Payment from Ph/sharma.kirana@okaxis/ICICI Bank,412345678901,04/09/26,320.00,,"93,339.50"',
    '05/09/26,ATW-512345XXXXXX1234-S1ANMU12-MUMBAI,0000000000000002,05/09/26,"2,000.00",,"91,339.50"',
    '05/09/26,ATW-512345XXXXXX1234-S1ANMU12-MUMBAI,0000000000000002,05/09/26,"2,000.00",,"91,339.50"',
    ',,Closing balance,,,,"91,339.50"',
  ].join('\r\n');

  it('reads every line, finds both duplicates, and numbers lines as the file does', () => {
    const rows = parseCsv(statement);
    const header = findHeader(rows)!;
    const lines = normalizeRows(rows.slice(header.index + 1), header.mapping, header.index + 2);

    expect(lines).toHaveLength(7);
    const out = lines.filter((l) => l.direction === 'out');
    expect(out).toHaveLength(5);
    expect(out.reduce((s, l) => s + l.amountPaise!, 0)).toBe(641_050);
    expect(lines.filter((l) => l.direction === 'in').map((l) => l.amountPaise)).toEqual([5_000_000]);
    expect(lines.filter((l) => l.problem)).toHaveLength(1);
    expect(lines[0].rowNumber).toBe(4);

    const marks = markDuplicates(lines, [{ id: 'typed', spentOn: '2026-09-02', amountPaise: 25_000 }]);
    expect(marks.get(5)).toEqual({ ofRow: null, ofSpend: 'typed', ofIncome: null });
    expect(marks.get(9)).toEqual({ ofRow: 8, ofSpend: null, ofIncome: null });
    expect(marks.size).toBe(2);
  });
});

describe('duplicates', () => {
  const row = (rowNumber: number, occurredOn: string, rupees: number, description: string): NormalizedRow => ({
    rowNumber,
    cells: [],
    occurredOn,
    description,
    amountPaise: rupees * 100,
    direction: 'out',
    merchantKey: merchantKey(description),
    problem: null,
  });

  it('flags a row repeated in the same file, such as overlapping exports', () => {
    const marks = markDuplicates(
      [row(1, '2026-09-01', 250, 'UPI/1234/SWIGGY'), row(2, '2026-09-01', 250, 'UPI/1234/SWIGGY')],
      [],
    );
    expect(marks.get(2)).toEqual({ ofRow: 1, ofSpend: null, ofIncome: null });
    expect(marks.has(1)).toBe(false);
  });

  it('keeps two genuinely separate payments with different references', () => {
    const marks = markDuplicates(
      [row(1, '2026-09-01', 20, 'UPI/1111/TEA STALL'), row(2, '2026-09-01', 20, 'UPI/2222/TEA STALL')],
      [],
    );
    expect(marks.size).toBe(0);
  });

  it('matches a spend already typed in by hand, a day either side', () => {
    const marks = markDuplicates(
      [row(1, '2026-09-02', 250, 'UPI/1/SWIGGY'), row(2, '2026-09-05', 250, 'UPI/2/SWIGGY')],
      [
        { id: 's1', spentOn: '2026-09-01', amountPaise: 25_000 },
        { id: 's2', spentOn: '2026-09-01', amountPaise: 99_900 },
      ],
    );
    expect(marks.get(1)).toEqual({ ofRow: null, ofSpend: 's1', ofIncome: null });
    // Three days out is a different payment of the same amount.
    expect(marks.has(2)).toBe(false);
  });

  it('matches each existing spend to one row at most', () => {
    const marks = markDuplicates(
      [row(1, '2026-09-01', 250, 'UPI/1/SWIGGY'), row(2, '2026-09-02', 250, 'UPI/2/SWIGGY')],
      [{ id: 's1', spentOn: '2026-09-01', amountPaise: 25_000 }],
    );
    expect(marks.get(1)?.ofSpend).toBe('s1');
    expect(marks.has(2)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* What a line is                                                      */
/* ------------------------------------------------------------------ */

const line = (
  rowNumber: number,
  direction: 'in' | 'out',
  rupees: number,
  description: string,
  occurredOn = '2026-09-05',
): NormalizedRow => ({
  rowNumber,
  cells: [],
  occurredOn,
  description,
  amountPaise: rupees * 100,
  direction,
  merchantKey: merchantKey(description),
  problem: null,
});

describe('classifying a line', () => {
  it('files ordinary money out as spending, with the category suggestion', () => {
    const c = classifyLine(line(1, 'out', 250, 'UPI-SWIGGY-SWIGGY8@YBL-1-PAYMENT'), []);
    expect(c).toMatchObject({ kind: 'expense', category: 'eating_out', source: 'keyword' });
  });

  /*
   * A card bill paid from the bank is money moving to the card. The spending is
   * on the card statement; counting the bill too would count it twice.
   */
  it('treats a credit card bill as a transfer, not spending', () => {
    for (const narration of ['BIL/ONL/000123/CRED CLUB/CC PAYMENT', 'HDFC CREDIT CARD AUTOPAY 4XXX', 'NEFT DR-CC BILL PAYMENT SBI CARD']) {
      const c = classifyLine(line(1, 'out', 18_000, narration), []);
      expect(c.kind, narration).toBe('transfer');
      expect(c.reason).toMatch(/card/i);
    }
  });

  it('treats money moved to your own account as a transfer', () => {
    expect(classifyLine(line(1, 'out', 5_000, 'IMPS-TRANSFER TO SELF-ICICI'), []).kind).toBe('transfer');
    expect(classifyLine(line(1, 'in', 5_000, 'NEFT CR-OWN ACCOUNT TRANSFER'), []).kind).toBe('transfer');
  });

  it('recognises money put into investments or deposits as saving', () => {
    for (const narration of ['ACH D- ZERODHA BROKING-SIP', 'NACH DR MUTUAL FUND SIP 09', 'RD INSTALLMENT 0012', 'GROWW INVEST']) {
      expect(classifyLine(line(1, 'out', 5_000, narration), []).kind, narration).toBe('saving');
    }
  });

  it('reads salary and interest as income, and a refund as a refund', () => {
    expect(classifyLine(line(1, 'in', 50_000, 'NEFT CR-ACME PAYROLL-SALARY SEP'), [])).toMatchObject({ kind: 'income', source: 'keyword' });
    expect(classifyLine(line(1, 'in', 312, 'INT.PD:01-06-2026 TO 31-08-2026'), []).kind).toBe('income');
    expect(classifyLine(line(1, 'in', 499, 'UPI REFUND AMAZON'), []).kind).toBe('refund');
  });

  it('does not claim to know what an unexplained credit is', () => {
    const c = classifyLine(line(1, 'in', 800, 'UPI/412345/RAVI KUMAR/okaxis'), []);
    expect(c).toMatchObject({ kind: 'income', source: 'none' });
  });

  it('follows what the person taught it, per direction, including the goal and source', () => {
    const rules = [
      { merchantKey: 'zerodha', direction: 'out' as const, kind: 'saving' as const, category: null, savingsGoalId: 'g1', incomeSourceId: null },
      { merchantKey: 'ravi kumar', direction: 'in' as const, kind: 'transfer' as const, category: null, savingsGoalId: null, incomeSourceId: null },
      { merchantKey: 'ravi kumar', direction: 'out' as const, kind: 'expense' as const, category: 'rent' as const, savingsGoalId: null, incomeSourceId: null },
    ];
    expect(classifyLine(line(1, 'out', 5_000, 'ACH D- ZERODHA'), rules)).toMatchObject({ kind: 'saving', savingsGoalId: 'g1', source: 'rule' });
    expect(classifyLine(line(1, 'in', 800, 'UPI/1/RAVI KUMAR/okaxis'), rules)).toMatchObject({ kind: 'transfer', source: 'rule' });
    expect(classifyLine(line(1, 'out', 12_000, 'UPI/2/RAVI KUMAR/okaxis'), rules)).toMatchObject({ kind: 'expense', category: 'rent' });
  });
});

describe('transfers between two statements', () => {
  it('pairs money out of one account with the same amount into another, a couple of days apart', () => {
    const rows = [line(4, 'out', 5_000, 'IMPS-P2A-9876-SAJEE', '2026-09-05')];
    const pairs = pairTransfers(rows, [{ id: 'other-row', direction: 'in', amountPaise: 500_000, occurredOn: '2026-09-06', kind: 'income' }]);
    expect(pairs.get(4)).toEqual({ rowNumber: null, otherRowId: 'other-row' });
  });

  it('pairs two legs in the same file only when one of them reads as a transfer', () => {
    const plain = [line(1, 'out', 500, 'UPI/1/TEA'), line(2, 'in', 500, 'UPI/2/FRIEND')];
    expect(pairTransfers(plain, []).size).toBe(0);

    const self = [line(1, 'out', 5_000, 'IMPS TRANSFER TO SELF'), line(2, 'in', 5_000, 'NEFT CR-SAJEE')];
    const pairs = pairTransfers(self, []);
    expect(pairs.get(1)).toEqual({ rowNumber: 2, otherRowId: null });
    expect(pairs.get(2)).toEqual({ rowNumber: 1, otherRowId: null });
  });

  it('does not pair across more than two days, or the same direction', () => {
    const rows = [line(1, 'out', 5_000, 'IMPS-P2A', '2026-09-01')];
    expect(pairTransfers(rows, [{ id: 'x', direction: 'in', amountPaise: 500_000, occurredOn: '2026-09-04', kind: null }]).size).toBe(0);
    expect(pairTransfers(rows, [{ id: 'y', direction: 'out', amountPaise: 500_000, occurredOn: '2026-09-01', kind: null }]).size).toBe(0);
  });
});

describe('income already recorded', () => {
  it('matches money in against income typed in by hand', () => {
    const marks = markDuplicates(
      [line(1, 'in', 50_000, 'SALARY', '2026-09-01')],
      [],
      [{ id: 'inc1', receivedOn: '2026-09-01', amountPaise: 5_000_000 }],
    );
    expect(marks.get(1)).toEqual({ ofRow: null, ofSpend: null, ofIncome: 'inc1' });
  });
});
