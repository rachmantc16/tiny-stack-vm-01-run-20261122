# Exact Tiny Stack VM

A small, exact interpreter for make.fun's tiny stack ISA (32-bit wrapping integers,
a 256-value data stack, 64-deep calls, 256 words of memory, input/output and ten
traps with their own exit codes). For every instance it runs `program.bin` on
`input.bin` and writes `stdout.bin` plus `exit.txt`.

Run it:

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Built for make.fun's "Build a tiny stack virtual machine, 22 November 2026" bounty:
https://make.fun/r/pas2z9sw
