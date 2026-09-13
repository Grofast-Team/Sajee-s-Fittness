'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import { formatRupees } from '@/lib/engines/money';
import { findHeader, normalizeRows, parseCsv, type Mapping } from '@/lib/engines/bank-import';
import { stageImport } from '@/lib/actions/bank-import';

/**
 * Choosing a statement and saying what its columns are.
 *
 * The file is read in the browser — it never leaves as a file — and its lines
 * are sent as cells for the server to normalise again. The mapping is guessed
 * from the header and shown, with the first lines read through it, so a wrong
 * guess (a value date taken for the transaction date, say) is visible before
 * anything is stored.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 3000;

interface Loaded {
  fileName: string;
  rows: string[][];
  headerIndex: number;
  header: string[];
  mapping: Mapping;
}

export function CsvUpload({ canImport }: { canImport: boolean }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staging, startTransition] = useTransition();

  async function onFile(file: File | undefined) {
    setError(null);
    setLoaded(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 2 MB. Export a shorter date range and try again.');
      return;
    }

    const rows = parseCsv(await file.text());
    const found = findHeader(rows);
    if (!found) {
      setError(
        'We could not find the columns in that file. It needs a header row with a date, a description, and either withdrawal and deposit columns or an amount. Most banks offer this as a CSV or "Excel (CSV)" download.',
      );
      return;
    }

    const body = rows.slice(found.index + 1);
    if (body.length > MAX_LINES) {
      setError(`That statement has ${body.length} lines. Export at most ${MAX_LINES} at a time — a few months at once.`);
      return;
    }

    setLoaded({ fileName: file.name, rows: body, headerIndex: found.index, header: rows[found.index], mapping: found.mapping });
  }

  const preview = useMemo(
    () => (loaded ? normalizeRows(loaded.rows, loaded.mapping, loaded.headerIndex + 2) : []),
    [loaded],
  );

  const readable = preview.filter((r) => !r.problem);
  const out = readable.filter((r) => r.direction === 'out');
  const inn = readable.filter((r) => r.direction === 'in');

  function setMapping(change: Partial<Mapping>) {
    setLoaded((current) => (current ? { ...current, mapping: { ...current.mapping, ...change } } : current));
  }

  function stage() {
    if (!loaded) return;
    setError(null);
    startTransition(async () => {
      const result = await stageImport({
        fileName: loaded.fileName.slice(0, 200),
        headerIndex: loaded.headerIndex,
        mapping: loaded.mapping,
        // Cells are capped at the length the server accepts; a narration longer
        // than that is a bank's padding, not information.
        rows: loaded.rows.map((r) => r.slice(0, 40).map((c) => c.slice(0, 500))),
      });
      if (result.ok) router.push(`/money/import/${result.batchId}`);
      else startTransition(() => setError(result.error));
    });
  }

  const columnOptions = loaded
    ? loaded.header.map((name, i) => ({ value: i, label: name || `Column ${i + 1}` }))
    : [];

  const split = loaded ? loaded.mapping.debit !== null || loaded.mapping.credit !== null : false;

  return (
    <div>
      <label
        htmlFor="statement-file"
        className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 border border-dashed p-4 text-center text-sm"
        style={{ borderColor: 'var(--line-strong)', borderRadius: 'var(--radius-control)', color: 'var(--fg-muted)' }}
      >
        <FileUp size={20} aria-hidden />
        <span>
          <span style={{ color: 'var(--primary-dark)', fontWeight: 600 }}>Choose a statement</span> (CSV, up to 2 MB)
        </span>
        <span className="text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
          {loaded ? loaded.fileName : 'Read on this device. Nothing is recorded until you confirm it.'}
        </span>
      </label>
      <input
        id="statement-file"
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={!canImport}
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      {loaded ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ColumnSelect label="Date" value={loaded.mapping.date} options={columnOptions} onChange={(v) => setMapping({ date: v! })} />
            <ColumnSelect
              label="Description"
              value={loaded.mapping.description}
              options={columnOptions}
              onChange={(v) => setMapping({ description: v! })}
            />
            {split ? (
              <>
                <ColumnSelect
                  label="Money out (withdrawals)"
                  value={loaded.mapping.debit}
                  options={columnOptions}
                  onChange={(v) => setMapping({ debit: v })}
                />
                <ColumnSelect
                  label="Money in (deposits)"
                  value={loaded.mapping.credit}
                  options={columnOptions}
                  onChange={(v) => setMapping({ credit: v })}
                />
              </>
            ) : (
              <>
                <ColumnSelect label="Amount" value={loaded.mapping.amount} options={columnOptions} onChange={(v) => setMapping({ amount: v })} />
                <ColumnSelect
                  label="Dr / Cr"
                  value={loaded.mapping.type}
                  options={columnOptions}
                  allowNone
                  onChange={(v) => setMapping({ type: v })}
                />
              </>
            )}
            <Field label="Dates are written" htmlFor="map-date-order">
              <select
                id="map-date-order"
                value={loaded.mapping.dateOrder}
                onChange={(e) => setMapping({ dateOrder: e.target.value as Mapping['dateOrder'] })}
                className={inputClass}
                style={inputStyle}
              >
                <option value="dmy">Day / month / year</option>
                <option value="mdy">Month / day / year</option>
                <option value="ymd">Year-month-day</option>
              </select>
            </Field>
            {!split && loaded.mapping.type === null ? (
              <Field label="A positive amount is" htmlFor="map-positive" description="Negative amounts are always money out.">
                <select
                  id="map-positive"
                  value={loaded.mapping.positiveIs}
                  onChange={(e) => setMapping({ positiveIs: e.target.value as Mapping['positiveIs'] })}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="in">Money in</option>
                  <option value="out">Money out (card statements)</option>
                </select>
              </Field>
            ) : null}
          </div>

          <div>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                {out.length}
              </span>{' '}
              out ({formatRupees(out.reduce((s, r) => s + (r.amountPaise ?? 0), 0))}),{' '}
              <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                {inn.length}
              </span>{' '}
              in ({formatRupees(inn.reduce((s, r) => s + (r.amountPaise ?? 0), 0))})
              {preview.length > readable.length ? `, ${preview.length - readable.length} we cannot read` : ''}.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-[13px]">
                <caption className="sr-only">The first lines, read with these columns</caption>
                <tbody>
                  {preview.slice(0, 5).map((r) => (
                    <tr key={r.rowNumber} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                      <td className="data py-1.5 pr-2" style={{ color: 'var(--fg-subtle)' }}>
                        {r.occurredOn ?? '—'}
                      </td>
                      <td className="max-w-[16rem] truncate py-1.5 pr-2">{r.problem ?? r.description}</td>
                      <td className="data py-1.5 text-right" style={{ fontWeight: 600 }}>
                        {r.amountPaise === null ? '' : `${r.direction === 'out' ? '−' : '+'}${formatRupees(r.amountPaise)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Button fullWidth disabled={staging || !canImport || readable.length === 0} onClick={stage}>
            {staging ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden /> Checking {preview.length} lines…
              </>
            ) : (
              `Check these ${preview.length} lines`
            )}
          </Button>
          <p className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
            Next you will see possible duplicates and suggested categories. Nothing is recorded until you
            confirm.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  options,
  allowNone = false,
  onChange,
}: {
  label: string;
  value: number | null;
  options: { value: number; label: string }[];
  allowNone?: boolean;
  onChange: (value: number | null) => void;
}) {
  const id = `map-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputClass}
        style={inputStyle}
      >
        {allowNone || value === null ? <option value="">None</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
