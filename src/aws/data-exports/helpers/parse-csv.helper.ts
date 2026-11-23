import { MAX_CSV_FIELD_LENGTH } from '../constants/data-exports.constant';

export async function* parseCsv(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closingQuote = false;
  let started = false;
  for await (const text of chunks) {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (closingQuote) {
        closingQuote = false;
        if (c === '"') {
          field += '"';
          continue;
        }
        quoted = false;
      }
      if (quoted) {
        if (c === '"') closingQuote = true;
        else field += c;
      } else if (c === '"' && field === '') {
        quoted = true;
        started = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
        started = true;
      } else if (c === '\n') {
        if (started || field !== '') yield [...row, field];
        row = [];
        field = '';
        started = false;
      } else if (c !== '\r') {
        field += c;
      }
      if (field.length > MAX_CSV_FIELD_LENGTH) throw new Error('CSV field too long');
    }
  }
  if (quoted && !closingQuote) throw new Error('CSV ended inside a quoted field');
  if (started || field !== '') yield [...row, field];
}
