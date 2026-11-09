/** `ledger set SC-NN <status>`: edit the status cell of one ledger row. */
const STATUS_COLUMN = 6; // | id | wave | size | title | agent | status | deps |

export function setLedgerStatus(text: string, id: string, status: string): string {
  if (!/^SC-\d+[a-z]?$/.test(id)) throw new Error(`not a ledger id: ${id}`);
  if (status.trim() === '' || /[|\r\n]/.test(status)) {
    throw new Error('status must be one line without |');
  }
  const lines = text.split('\n');
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith('|') && line.split('|')[1]?.trim() === id) hits.push(i);
  });
  if (hits.length !== 1) {
    throw new Error(`expected exactly one ledger row for ${id}, found ${hits.length}`);
  }
  const at = hits[0] as number;
  const cells = (lines[at] as string).split('|');
  if (cells.length < STATUS_COLUMN + 2) throw new Error(`row for ${id} has too few columns`);
  cells[STATUS_COLUMN] = ` ${status.trim()} `;
  lines[at] = cells.join('|');
  return lines.join('\n');
}
