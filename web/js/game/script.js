// Cutscene scripts (same VM as the PSP release; layout from Gibbed's
// ScriptFormats, zlib). Header magic 0x8000000C; each script is a run of
// one-byte opcodes, opcodes 72..99 carrying a 16-bit immediate. Natives are
// `Call <n>` with their arguments pushed just before.
//
// A script entry holds one main script ("cut_scene_*") and helper scripts,
// one per character or effect. Each script has named functions; the event
// table says which function starts on its own (event 0 -> usually "main").
// Helpers run when another script requests them (opcodes from FF12's VM):
//   REQ        pops priority, script, function: start it, don't wait
//   REQWAIT    pops script, function: wait until it has finished
//   REQALL n   pops priority: start every (script, function) in request table n
//   REQWAITALL n  wait for all of request table n

import { view } from '../lib/pakd.js';
import { NATIVES } from './natives.js';

const OP = {
  Return: 45, REQ: 33, REQWAIT: 50, PushInt0: 62, PushInt3: 65, PushVariable: 72, PushIntFromTable: 78,
  PushIntImmediate: 79, PushFloatFromTable: 80, Jump: 81, Call: 88, PopXAndJumpIfZero: 92, CallAndPopA: 93,
  REQALL: 95, JumpInternal: 96, REQWAITALL: 97,
};
const hasImmediate = (op) => op >= 72 && op <= 99;

export const isScript = (d) => d.length >= 0x64 && (view(d).getUint32(0, true) & 0xFFFF0000) >>> 0 === 0x80000000;

export function parseScriptFile(d) {
  const v = view(d);
  const u32 = (o) => v.getUint32(o, true);
  const i32 = (o) => v.getInt32(o, true);
  const H = {
    author: u32(0x08), source: u32(0x0C), scriptTable: u32(0x18), ints: u32(0x20), floats: u32(0x24),
    requests: u32(0x30), strings: u32(0x4C),
  };
  const cstr = (o) => { let e = o; while (d[e]) e++; return new TextDecoder().decode(d.subarray(o, e)); }; // UTF-8 in Reborn
  const ints = Array.from({ length: i32(H.ints) }, (_, i) => i32(H.ints + 4 + i * 4));
  const floats = Array.from({ length: i32(H.floats) }, (_, i) => v.getFloat32(H.floats + 4 + i * 4, true));
  const requests = Array.from({ length: i32(H.requests) }, (_, i) => {
    const o = u32(H.requests + 4 + i * 4);
    return Array.from({ length: u32(o) }, (_, k) => ({ script: v.getInt16(o + 4 + k * 4, true), fn: v.getInt16(o + 6 + k * 4, true) }));
  });
  const scripts = [];
  const count = i32(H.scriptTable);
  for (let i = 0; i < count; i++) {
    const h = H.scriptTable + 4 + i * 48;
    const codeOffset = u32(h + 8);
    const codeCount = i32(h + 12);
    const fnTable = u32(h + 16);
    const eventTable = u32(h + 24);
    const code = [];
    const indexAt = new Map(); // offset from code start -> instruction index
    let o = codeOffset;
    for (let k = 0; k < codeCount; k++) {
      indexAt.set(o - codeOffset, k);
      const op = d[o];
      const at = o;
      o++;
      let imm = null;
      if (hasImmediate(op)) { imm = v.getInt16(o, true); o += 2; }
      code.push({ op, imm, at });
    }
    indexAt.set(o - codeOffset, codeCount);
    const functions = Array.from({ length: i32(fnTable) }, (_, k) => ({
      name: cstr(H.strings + u32(fnTable + 4 + k * 8)),
      start: indexAt.get(u32(fnTable + 8 + k * 8)) ?? codeCount,
    }));
    const starts = [...new Set(functions.map((f) => f.start)), codeCount].sort((a, b) => a - b);
    for (const f of functions) f.end = starts.find((s) => s > f.start) ?? codeCount;
    const events = Array.from({ length: v.getUint16(eventTable, true) }, (_, k) => v.getInt16(eventTable + 2 + k * 2, true));
    scripts.push({ name: cstr(H.strings + u32(h)), code, functions, events });
  }
  return { author: cstr(H.author), source: cstr(H.source), ints, floats, requests, scripts };
}

// ---- writing -------------------------------------------------------------
// Inserting or removing code moves the edited script's code to the end of the
// file (header TotalSize grows), so no other section moves and no other
// offset needs fixing. Inside the script, function starts after the edit and
// jump-table targets at or after it shift with the code; the old copy of the
// code is left unused.

/** Bytes for `native(args...)`: each argument pushed as an i16 immediate, then CallAndPopA. */
export function encodeCall(native, args) {
  const out = new Uint8Array(args.length * 3 + 3);
  const v = view(out);
  args.forEach((a, i) => {
    const n = Math.trunc(Number(a));
    if (!Number.isFinite(n) || n < -32768 || n > 32767) throw new Error(`argument ${a} out of range`);
    out[i * 3] = OP.PushIntImmediate;
    v.setInt16(i * 3 + 1, n, true);
  });
  out[args.length * 3] = OP.CallAndPopA;
  v.setInt16(args.length * 3 + 1, native, true);
  return out;
}

const instructionCount = (bytes) => {
  let n = 0;
  for (let o = 0; o < bytes.length; n++) o += hasImmediate(bytes[o]) ? 3 : 1;
  return n;
};

/**
 * Replace `deleteCount` instructions of script `si` from instruction `index`
 * with `insert` (encoded instructions). Returns the new file bytes, padded
 * like the game's (align16(total + 1)).
 */
export function spliceCode(d, si, index, deleteCount, insert = new Uint8Array(0)) {
  const v = view(d);
  const total = v.getUint32(0x04, true);
  const h = v.getUint32(0x18, true) + 4 + si * 48;
  const codeOffset = v.getUint32(h + 8, true);
  const codeCount = v.getInt32(h + 12, true);
  // byte offset (from code start) of each instruction, plus the end
  const at = [];
  let o = 0;
  for (let k = 0; k < codeCount; k++) { at.push(o); o += hasImmediate(d[codeOffset + o]) ? 3 : 1; }
  at.push(o);
  if (index < 0 || index > codeCount || index + deleteCount > codeCount) throw new Error('edit outside the script');
  const start = at[index], end = at[index + deleteCount];
  const shift = insert.length - (end - start);
  const code = new Uint8Array(o + shift);
  code.set(d.subarray(codeOffset, codeOffset + start), 0);
  code.set(insert, start);
  code.set(d.subarray(codeOffset + end, codeOffset + o), start + insert.length);
  const newTotal = total + code.length;
  const out = new Uint8Array((newTotal + 1 + 15) & ~15);
  out.set(d.subarray(0, total), 0);
  out.set(code, total);
  const w = view(out);
  w.setUint32(0x04, newTotal, true);
  w.setUint32(h + 8, total, true);
  w.setInt32(h + 12, codeCount - deleteCount + instructionCount(insert), true);
  const move = (x) => (x >= end ? x + shift : x >= start ? start : x);
  const fnTable = w.getUint32(h + 16, true);
  for (let k = 0; k < w.getInt32(fnTable, true); k++) {
    const p = fnTable + 8 + k * 8;
    const f = w.getUint32(p, true);
    if (f > start) w.setUint32(p, move(f), true); // a function starting at the edit keeps the new code
  }
  const jumpTable = w.getUint32(h + 20, true);
  for (let k = 0; k < w.getInt32(jumpTable, true); k++) {
    const p = jumpTable + 4 + k * 4;
    const j = w.getUint32(p, true);
    if (j >= start) w.setUint32(p, j === start && deleteCount === 0 ? j + shift : move(j), true); // jumps (e.g. "skip scene") pass over new code
  }
  return out;
}

/**
 * What one function does, in order:
 *   { type: 'call', native, name, args: [{value, at, kind}], at }
 *   { type: 'req', script, fn }      { type: 'reqwait', script, fn }
 *   { type: 'reqall', table }        { type: 'reqwaitall', table }
 * `at` of an argument is the byte offset of its push instruction, so a
 * PushIntImmediate argument can be patched in place (2-byte value at at+1).
 * Branches are not followed: the function is read straight through.
 */
export function functionOps(file, script, fn) {
  const ops = [];
  let stack = [];
  const pop = (n) => { const out = stack.slice(Math.max(0, stack.length - n)); stack = stack.slice(0, Math.max(0, stack.length - n)); return out; };
  const num = (a) => (typeof a?.value === 'number' ? a.value : null);
  for (let k = fn.start; k < fn.end; k++) {
    const { op, imm, at } = script.code[k];
    if (op === OP.PushIntImmediate) stack.push({ value: imm, at, kind: 'imm' });
    else if (op === OP.PushIntFromTable) stack.push({ value: file.ints[imm], at, kind: 'int' });
    else if (op === OP.PushFloatFromTable) stack.push({ value: Math.round(file.floats[imm] * 1000) / 1000, at, kind: 'float' });
    else if (op >= OP.PushInt0 && op <= OP.PushInt3) stack.push({ value: `r${op - OP.PushInt0}`, at, kind: 'reg' });
    else if (op === OP.PushVariable) stack.push({ value: `var${imm}`, at, kind: 'var' });
    else if (op === OP.Call || op === OP.CallAndPopA) {
      const [name, argc] = NATIVES.get(imm) ?? [`native_${imm}`, stack.length];
      // These natives accept an optional fifth flag. Their native wrappers
      // inspect the argument count before popping that flag.
      const count=(imm===258||imm===259)&&stack.length>=5?5:argc;
      ops.push({ type: 'call', native: imm, name, args: pop(count), at });
    } else if (op === OP.REQ) {
      const [, s, f] = pop(3);
      ops.push({ type: 'req', script: num(s), fn: num(f) });
    } else if (op === OP.REQWAIT) {
      const [s, f] = pop(2);
      ops.push({ type: 'reqwait', script: num(s), fn: num(f) });
    } else if (op === OP.REQALL) {
      pop(1);
      ops.push({ type: 'reqall', table: imm });
    } else if (op === OP.REQWAITALL) {
      ops.push({ type: 'reqwaitall', table: imm });
    } else if (op === OP.Return || op === OP.Jump || op === OP.JumpInternal || op === OP.PopXAndJumpIfZero) {
      stack = [];
    }
  }
  return ops;
}

/** Retain the native VM header/init, replacing its single main function with Return. */
export function blankScriptFromTemplate(data) {
  const file=parseScriptFile(data),script=file.scripts[0];
  if(file.scripts.length!==1||file.requests.length||script.functions.length!==2)throw new Error('The blank-scene template has an unsupported script layout.');
  const init=script.functions.find(f=>f.name==='init'),main=script.functions.find(f=>f.name==='main');
  if(!init||!main||script.code.slice(init.start,init.end).some(op=>op.op!==45))throw new Error('The template has initialization commands that cannot be copied.');
  const out=spliceCode(data,0,main.start,main.end-main.start,new Uint8Array([45]));
  const v=view(out),header=v.getUint32(0x18,true)+4,nameAt=v.getUint32(0x4c,true)+v.getUint32(header,true),name=new TextEncoder().encode('cut_scene_new');
  if(name.length>script.name.length)throw new Error('The template name is too short.');
  out.fill(0,nameAt,nameAt+script.name.length);out.set(name,nameAt);return out;
}
