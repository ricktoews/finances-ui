import { record } from './verifiedStatementData';

export function ImportStatusNotice({ data }: { data: unknown }) {
  return record(record(data).import_status).fully_imported === false
    ? <p className="status-message" role="status">Some statement data is awaiting import.</p> : null;
}
