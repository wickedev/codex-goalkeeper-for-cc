import fs from "node:fs";

// Claude Code hands the hook payload over on a blocking stdin socket. As soon
// as anything in the process creates `process.stdin` (importing "node:process"
// as a module does exactly that), libuv switches the shared fd to O_NONBLOCK,
// and a plain fs.readFileSync(0) then throws EAGAIN whenever the payload has
// not fully arrived yet ("Stop hook error: EAGAIN: resource temporarily
// unavailable, read"). Read fd 0 directly and wait out EAGAIN instead.
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

export function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  for (;;) {
    let bytesRead;
    try {
      bytesRead = fs.readSync(0, buf, 0, buf.length, null);
    } catch (error) {
      if (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") {
        Atomics.wait(sleepCell, 0, 0, 5);
        continue;
      }
      if (error?.code === "EOF") {
        break;
      }
      throw error;
    }
    if (bytesRead === 0) {
      break;
    }
    chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
