import { useEffect, useState } from 'react';
import {
  getVerifiedStatementData,
  getVerifiedStatementFiles,
} from '../api/financesApi';
import type { VerifiedStatementFile } from '../types/finance';

const defaultYear = '2026';

function formatLabel(value: string, fallback: string): string {
  if (!value.trim()) return fallback;
  return value.replaceAll('_', ' ');
}

export function JsonStatements() {
  const [year, setYear] = useState(defaultYear);
  const [files, setFiles] = useState<VerifiedStatementFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [statementData, setStatementData] = useState<unknown>(null);
  const [isFilesLoading, setIsFilesLoading] = useState(true);
  const [isStatementLoading, setIsStatementLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    getVerifiedStatementFiles(year)
      .then((nextFiles) => {
        if (isMounted) setFiles(nextFiles);
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setFiles([]);
          setFilesError(error instanceof Error ? error.message : 'Unable to load files.');
        }
      })
      .finally(() => {
        if (isMounted) setIsFilesLoading(false);
      });

    return () => { isMounted = false; };
  }, [year]);

  function changeYear(nextYear: string) {
    setYear(nextYear);
    setFiles([]);
    setSelectedFile(null);
    setStatementData(null);
    setFilesError(null);
    setStatementError(null);
    setIsFilesLoading(true);
    setIsStatementLoading(false);
  }

  async function selectFile(fileName: string) {
    setSelectedFile(fileName);
    setStatementData(null);
    setStatementError(null);
    setIsStatementLoading(true);

    try {
      setStatementData(await getVerifiedStatementData(year, fileName));
    } catch (error) {
      setStatementError(
        error instanceof Error ? error.message : 'Unable to load statement data.',
      );
    } finally {
      setIsStatementLoading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <h1>JSON Statements</h1>
        <p>Inspect verified statement JSON alongside its source file details.</p>
      </div>

      <div className="dashboard-toolbar json-statement-filters" aria-label="JSON statement filters">
        <div className="toolbar-metric">
          <span className="toolbar-label">Files</span>
          <strong>{files.length}</strong>
        </div>
        <label className="year-select">
          <span>Year</span>
          <input
            type="number"
            min="2000"
            max="2100"
            value={year}
            onChange={(event) => changeYear(event.target.value)}
          />
        </label>
      </div>

      <div className="json-statements-layout">
        <section className="content-section" aria-labelledby="verified-files-heading">
          <div className="section-heading">
            <div>
              <h2 id="verified-files-heading">Verified files</h2>
              <p>Statements available for {year}.</p>
            </div>
          </div>
          {isFilesLoading && <p className="panel-state">Loading files...</p>}
          {filesError && <p className="panel-state error-message" role="alert">{filesError}</p>}
          {!isFilesLoading && !filesError && files.length === 0 && (
            <p className="empty-state">No verified statement files found.</p>
          )}
          {!isFilesLoading && !filesError && files.length > 0 && (
            <ul className="verified-file-list">
              {files.map((file) => (
                <li key={file.fileName}>
                  <a
                    href={`#${encodeURIComponent(file.fileName)}`}
                    className={selectedFile === file.fileName ? 'selected-file' : undefined}
                    aria-current={selectedFile === file.fileName ? 'true' : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      void selectFile(file.fileName);
                    }}
                  >
                    <strong>{file.fileName}</strong>
                    <span>{formatLabel(file.statementDate, 'Date unavailable')}</span>
                    <span>{formatLabel(file.statementType, 'Type unavailable')}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="content-section json-data-section" aria-labelledby="statement-json-heading">
          <div className="section-heading">
            <div>
              <h2 id="statement-json-heading">Statement data</h2>
              <p>{selectedFile ?? 'Select a file to inspect its JSON.'}</p>
            </div>
          </div>
          {isStatementLoading && <p className="panel-state">Loading statement data...</p>}
          {statementError && <p className="panel-state error-message" role="alert">{statementError}</p>}
          {!selectedFile && <p className="empty-state">Choose a statement from the file list.</p>}
          {!isStatementLoading && !statementError && statementData !== null && (
            <pre className="statement-json"><code>{JSON.stringify(statementData, null, 2)}</code></pre>
          )}
        </section>
      </div>
    </>
  );
}
