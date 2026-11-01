import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScanUnavailableError, VirusFoundError, parseScanReply, scanBuffer, scanStatus, scanTarget } from "./virusScan";

// The EICAR anti-virus test string, assembled at run time so this source file doesn't itself trip a scanner.
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");

/** A minimal clamd: INSTREAM (flags the EICAR string), VERSION, and modes that misbehave. */
let mode: "ok" | "silent" | "error" = "ok";
const received: number[] = [];
const server = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, Buffer.isBuffer(d) ? d : Buffer.from(d)]);
    if (mode === "silent") return;
    const nul = buf.indexOf(0);
    if (nul < 0) return;
    const cmd = buf.subarray(0, nul).toString();
    if (cmd === "zVERSION") { sock.end("ClamAV 1.4.1/27450/Sat Nov  1 08:00:00 2026\0"); return; }
    if (cmd !== "zINSTREAM") { sock.end("UNKNOWN COMMAND\0"); return; }
    // Read [len][bytes] chunks until a zero length.
    let off = nul + 1; const parts: Buffer[] = [];
    while (buf.length >= off + 4) {
      const len = buf.readUInt32BE(off);
      if (len === 0) {
        const body = Buffer.concat(parts);
        received.push(body.length);
        if (mode === "error") sock.end("stream: Size limit reached ERROR\0");
        else sock.end(body.includes(EICAR) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        return;
      }
      if (buf.length < off + 4 + len) return;
      parts.push(buf.subarray(off + 4, off + 4 + len)); off += 4 + len;
    }
  });
});
let env: NodeJS.ProcessEnv;
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  env = { CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: String((server.address() as net.AddressInfo).port) };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("virus scanning (clamd INSTREAM)", () => {
  it("is off without CLAMAV_SOCKET / CLAMAV_HOST, and a socket path wins over a host", () => {
    expect(scanTarget({})).toBeNull();
    expect(scanTarget({ CLAMAV_HOST: "10.0.0.5" })).toEqual({ host: "10.0.0.5", port: 3310 });
    expect(scanTarget({ CLAMAV_SOCKET: "/run/clamav/clamd.ctl", CLAMAV_HOST: "x" })).toEqual({ path: "/run/clamav/clamd.ctl" });
    expect(scanTarget({ CLAMAV_HOST: "h", CLAMAV_PORT: "99999" })).toEqual({ host: "h", port: 3310 });
  });

  it("skips scanning when it's off", async () => {
    expect(await scanBuffer(Buffer.from(EICAR), {})).toBe("skipped");
  });

  it("passes a clean file, streaming all of it in chunks", async () => {
    mode = "ok";
    const big = Buffer.alloc(200_000, 7); // several 64 KB chunks
    expect(await scanBuffer(big, env)).toBe("clean");
    expect(received.at(-1)).toBe(200_000);
  });

  it("refuses the EICAR test file with the signature name", async () => {
    mode = "ok";
    await expect(scanBuffer(Buffer.from(EICAR), env)).rejects.toThrow(VirusFoundError);
    await expect(scanBuffer(Buffer.from(`%PDF-1.7\n${EICAR}\n%%EOF`), env)).rejects.toMatchObject({ signature: "Eicar-Test-Signature" });
  });

  it("fails closed when clamd is down, errors or times out; CLAMAV_FAIL_OPEN=1 skips instead", async () => {
    const down = { CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: "1" };
    await expect(scanBuffer(Buffer.from("x"), down)).rejects.toThrow(ScanUnavailableError);
    expect(await scanBuffer(Buffer.from("x"), { ...down, CLAMAV_FAIL_OPEN: "1" })).toBe("skipped");
    mode = "error";
    await expect(scanBuffer(Buffer.from("x"), env)).rejects.toThrow(/couldn't check this file \(Size limit reached ERROR\)/);
    mode = "silent";
    await expect(scanBuffer(Buffer.from("x"), { ...env, CLAMAV_TIMEOUT_MS: "300" })).rejects.toThrow(/did not answer in time/);
    mode = "ok";
  });

  it("reads clamd's replies", () => {
    expect(parseScanReply("stream: OK")).toEqual({ clean: true });
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND")).toEqual({ clean: false, signature: "Win.Test.EICAR_HDB-1" });
    expect(() => parseScanReply("")).toThrow(ScanUnavailableError);
  });

  it("reports status for Admin Settings", async () => {
    mode = "ok";
    expect(await scanStatus({})).toMatchObject({ enabled: false, ok: false });
    expect(await scanStatus(env)).toMatchObject({ enabled: true, ok: true, version: expect.stringContaining("ClamAV 1.4.1") });
    const down = await scanStatus({ CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: "1", CLAMAV_FAIL_OPEN: "1" });
    expect(down).toMatchObject({ enabled: true, ok: false, failOpen: true });
    expect(down.error).toMatch(/can't be reached/);
  });
});
