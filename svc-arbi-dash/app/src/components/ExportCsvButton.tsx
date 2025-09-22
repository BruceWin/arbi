import { downloadCsv, toCsv } from '../lib/csv';

type ExportCsvButtonProps<T extends Record<string, unknown>> = {
  filename: string;
  rows: T[];
};

function ExportCsvButton<T extends Record<string, unknown>>({ filename, rows }: ExportCsvButtonProps<T>) {
  return (
    <button
      onClick={() => {
        if (!rows.length) {
          return;
        }
        const headers = Object.keys(rows[0]);
        const csv = toCsv(headers, rows);
        downloadCsv(filename, csv);
      }}
      className="bg-slate-700 hover:bg-slate-600"
    >
      Export CSV
    </button>
  );
}

export default ExportCsvButton;
