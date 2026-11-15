// Write changed game files and keep Data/FileTable.bin in step.

import { checkFileTable, getRecordedSize, setRecordedSize } from '../lib/filetable.js';
import { source } from '../game/source.js';

export class SaveCancelled extends Error {
  constructor() { super('Save cancelled. Unsaved edits are still open.'); }
}

function confirmOverwrite(paths) {
  const list = paths.join('\n');
  if (!confirm(`These files changed since they were opened:\n\n${list}\n\nOverwrite with your open edits? This replaces newer edits in these files. Choose Cancel to keep editing or reload.`)) {
    throw new SaveCancelled();
  }
}

/** files: [{ path, bytes, originalSize, dat }] -> writes them and updates FileTable.bin. */
export async function saveDataFiles(files) {
  if (!files.length) return [];
  if (files.every(f => f.dat?.scope)) {
    const options = (f) => ({scope:f.dat.scope, revision:f.dat.revision, originalSize:f.dat.originalSize});
    const plan = await source.checkSave(files.map(f => ({path:f.path,...options(f)})));
    if (plan.conflicts.length) confirmOverwrite(plan.conflicts.map(f => f.path));
    const confirmed = new Map(plan.conflicts.map(f => [f.path,f.overwrite]));
    for (const f of files) {
      let overwrite = confirmed.get(f.path);
      let result;
      do {
        result = await source.write(f.path, f.bytes, {...options(f),overwrite});
        if (result.overwrite) {
          confirmOverwrite([f.path]);
          overwrite = result.overwrite;
        }
      } while (result.overwrite);
      f.savedSize = result.size;
      Object.assign(f.dat,{originalSize:result.size, scope:result.scope, revision:result.revision, view:result.view});
    }
    return files.map(f => f.path);
  }
  const { bytes: table } = await source.read('FileTable.bin');
  checkFileTable(table);
  const changed = files.filter(f => getRecordedSize(table,f.path) !== f.originalSize);
  if (changed.length) confirmOverwrite(changed.map(f => f.path));
  for (const f of files) {
    const result = await source.write(f.path, f.bytes, f.dat);
    f.savedSize = result.size ?? f.bytes.length;
    if (f.dat) Object.assign(f.dat,{originalSize:f.savedSize,view:result.view});
    setRecordedSize(table, f.path, f.savedSize);
  }
  await source.write('FileTable.bin', table);
  return files.map((f) => f.path);
}
