// Exact tiny stack VM for make.fun's ISA v1. For every instance id in the input
// dir it runs program.bin on input.bin and writes stdout.bin + exit.txt.
// Fetch order: step limit, pc in range, known opcode, immediate fits, stack
// needs (underflow, then overflow), then the opcode's own traps and effect.
// A trap ends the program at once; its code is the exit code and the output
// written before it is kept. HALT exits 0, EXIT exits its value's low byte.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Per opcode: [immediate bytes, values popped, values pushed].
const SPEC = new Map([
  [0x00, [0, 0, 0]], [0x01, [1, 0, 1]], [0x02, [4, 0, 1]], [0x03, [0, 1, 0]],
  [0x04, [0, 1, 2]], [0x05, [0, 2, 2]], [0x06, [0, 2, 3]], [0x07, [0, 3, 3]],
  [0x10, [0, 2, 1]], [0x11, [0, 2, 1]], [0x12, [0, 2, 1]], [0x13, [0, 2, 1]],
  [0x14, [0, 2, 1]], [0x15, [0, 2, 1]], [0x16, [0, 2, 1]], [0x17, [0, 1, 1]],
  [0x18, [0, 2, 1]], [0x19, [0, 2, 1]], [0x1a, [0, 2, 1]], [0x1b, [0, 1, 1]],
  [0x1c, [0, 2, 1]], [0x1d, [0, 2, 1]], [0x1e, [0, 2, 1]], [0x20, [0, 2, 1]],
  [0x21, [0, 2, 1]], [0x22, [0, 2, 1]], [0x30, [2, 0, 0]], [0x31, [2, 1, 0]],
  [0x32, [2, 1, 0]], [0x33, [2, 0, 0]], [0x34, [0, 0, 0]], [0x40, [0, 1, 1]],
  [0x41, [0, 2, 0]], [0x50, [0, 1, 0]], [0x51, [0, 1, 0]], [0x52, [0, 0, 1]],
  [0x53, [0, 1, 0]],
]);

// Runs one program on its input. Returns [output bytes, exit code].
function run(prog, input) {
  const n = prog.length;
  const stack = new Int32Array(256);
  let sp = 0;
  const calls = new Int32Array(64);
  let cp = 0;
  const mem = new Int32Array(256);
  const out = [];
  let inPos = 0;
  let pc = 0;
  let steps = 0;
  for (;;) {
    if (steps === 1000000) return [out, 10];
    if (pc < 0 || pc >= n) return [out, 9];
    const byte = prog[pc];
    const spec = SPEC.get(byte);
    if (spec === undefined) return [out, 5];
    const imm = spec[0];
    if (pc + imm >= n) return [out, 9];
    steps++;
    const next = pc + 1 + imm;
    if (sp < spec[1]) return [out, 2];
    if (sp - spec[1] + spec[2] > 256) return [out, 3];
    pc = next;
    switch (byte) {
      case 0x00: return [out, 0];
      case 0x01: stack[sp++] = (prog[next - 1] << 24) >> 24; break;
      case 0x02:
        stack[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;
      case 0x03: sp--; break;
      case 0x04: stack[sp] = stack[sp - 1]; sp++; break;
      case 0x05: {
        const t = stack[sp - 1];
        stack[sp - 1] = stack[sp - 2];
        stack[sp - 2] = t;
        break;
      }
      case 0x06: stack[sp] = stack[sp - 2]; sp++; break;
      case 0x07: {
        const a = stack[sp - 3];
        stack[sp - 3] = stack[sp - 2];
        stack[sp - 2] = stack[sp - 1];
        stack[sp - 1] = a;
        break;
      }
      case 0x17: stack[sp - 1] = -stack[sp - 1] | 0; break;
      case 0x1b: stack[sp - 1] = ~stack[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = stack[sp - 1];
        const a = stack[sp - 2];
        let r;
        if (byte === 0x10) r = (a + b) | 0;
        else if (byte === 0x11) r = (a - b) | 0;
        else if (byte === 0x12) r = Math.imul(a, b);
        else if (byte === 0x13) {
          if (b === 0) return [out, 4];
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (byte === 0x14) {
          if (b === 0) return [out, 4];
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (byte === 0x15) {
          if (b === 0) return [out, 4];
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (byte === 0x16) {
          if (b === 0) return [out, 4];
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (byte === 0x18) r = a & b;
        else if (byte === 0x19) r = a | b;
        else if (byte === 0x1a) r = a ^ b;
        else if (byte === 0x1c) r = a << (b & 31);
        else if (byte === 0x1d) r = a >> (b & 31);
        else if (byte === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (byte === 0x20) r = a === b ? 1 : 0;
        else if (byte === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        stack[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (byte !== 0x30) {
          const v = stack[--sp];
          take = byte === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return [out, 7];
        calls[cp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return [out, 8];
        pc = calls[--cp];
        break;
      case 0x40: {
        const addr = stack[sp - 1];
        if (addr < 0 || addr > 255) return [out, 6];
        stack[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = stack[sp - 1];
        const v = stack[sp - 2];
        if (addr < 0 || addr > 255) return [out, 6];
        sp -= 2;
        mem[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(stack[sp - 1]);
        if (out.length + s.length > 65536) return [out, 11];
        sp--;
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        break;
      }
      case 0x51:
        if (out.length + 1 > 65536) return [out, 11];
        out.push(stack[--sp] & 255);
        break;
      case 0x52: stack[sp++] = inPos < input.length ? input[inPos++] : -1; break;
      case 0x53: return [out, stack[--sp] & 255];
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const prog = readFileSync(join(IN_DIR, id, 'program.bin'));
  const input = readFileSync(join(IN_DIR, id, 'input.bin'));
  const [out, exit] = run(prog, input);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), Buffer.from(out));
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), String(exit) + '\n');
}
