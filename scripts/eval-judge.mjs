/**
 * Evaluate the outcome classifier against the host's own ground truth.
 *
 * ZCode's tool_usage table labels every real tool call completed/error; our
 * judgeOutcome() decides ok/failure from the SAME evidence a live adapter
 * would see (rendered body + structured value). Replaying 20k real calls and
 * comparing turns the classifier from "tested on fixtures" to "validated on
 * reality" — and every disagreement is either a real bug or a labeled fixture.
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { judgeOutcome } from '../dsh-immune-system/dist/dsh/src/dsh-adapter.js';

const source = `${homedir()}/.zcode/cli/db/db.sqlite`.replace(/\\/g, '/');
const db = new DatabaseSync(source, { readOnly: true });

const rows = db
  .prepare(
    `SELECT session_id, tool_call_id, tool_name, status, exit_code, error_message
       FROM tool_usage
      WHERE status IN ('completed','error')
      ORDER BY started_at ASC`,
  )
  .all();

// Pre-filter on leading 200 bytes so SQLite skips overflow pages for non-tool parts (~50x faster).
const partsByKey = new Map();
for (const p of db
  .prepare(
    `SELECT session_id,
            json_extract(data, '$.callID') AS call_id,
            substr(json_extract(data, '$.state.output'), 1, 2048) AS output_text
       FROM part
      WHERE substr(data, 1, 200) LIKE '%"type":"tool"%'`,
  )
  .all()) {
  if (p.call_id && typeof p.output_text === 'string') {
    partsByKey.set(`${p.session_id}:${p.call_id}`, p.output_text);
  }
}

let agree = 0;
let falsePositives = 0; // host: success, judge: failure
let falseNegatives = 0; // host: error, judge: success
const disagreements = [];

for (const row of rows) {
  const output = partsByKey.get(`${row.session_id}:${row.tool_call_id}`) ?? '';
  const content = [{ type: 'text', text: output }];
  const value = {};
  if (row.exit_code !== null && row.exit_code !== undefined) value.exitCode = row.exit_code;
  if (row.status === 'error' && row.error_message) value.is_error = true;

  const result = {
    // The live adapter receives the host's own error classification; starving
    // the judge of it would measure the harness, not the judge.
    isError: row.status === 'error' && !!row.error_message && value.exitCode === undefined,
    error: row.error_message ? { message: row.error_message } : undefined,
    content,
    value: Object.keys(value).length > 0 ? value : undefined,
  };
  const judged = judgeOutcome(result, output);
  const hostFailed = row.status === 'error';

  if (judged.ok !== !hostFailed) {
    if (hostFailed) falseNegatives += 1;
    else falsePositives += 1;
    if (disagreements.length < 12) {
      disagreements.push({
        kind: hostFailed ? 'false-negative' : 'false-positive',
        tool: row.tool_name,
        exit: row.exit_code,
        err: (row.error_message ?? '').slice(0, 90),
        out: output.slice(0, 120),
        judgedError: judged.errorText.slice(0, 60),
      });
    }
  } else {
    agree += 1;
  }
}

const total = rows.length;
console.log(`replayed ${total} real tool calls`);
console.log(
  `agreement ${(agree * 100 / total).toFixed(2)}% · ` +
    `false-positive ${falsePositives} · false-negative ${falseNegatives}`,
);
for (const d of disagreements) console.log('--', JSON.stringify(d));
db.close();
