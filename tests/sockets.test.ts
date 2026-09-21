/**
 * The three WebSocket clients, and how the credential reaches a handshake.
 *
 * No test here opens a connection: `FakeWS` implements the same small surface
 * (`send`, `close`, `addEventListener`) that `WebSocketLike` declares, which
 * is the whole reason that type exists.
 */
import { describe, expect, it } from "vitest";
import { Caged } from "../src/client";
import { MarkerFilter } from "../src/stream";
import { MCPError } from "../src/mcp";
import { CagedError } from "../src/errors";
import type { WebSocketLike } from "../src/types";
import { VERSION } from "../src/version";

type Listener = (event: { data?: unknown }) => void;

class FakeWS implements WebSocketLike {
  public readonly sent: string[] = [];
  public closed = false;
  private readonly listeners = new Map<string, Listener[]>();
  /** When set, every JSON-RPC request is answered with an empty result. */
  public autoAnswer = false;

  send(data: string): void {
    this.sent.push(data);
    if (!this.autoAnswer) return;
    const request = JSON.parse(data) as { id?: number };
    if (typeof request.id === "number") {
      this.emit("message", {
        data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }),
      });
    }
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
    // The client awaits "open" before handing the socket to anyone.
    if (type === "open") listener({});
  }

  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  output(data: string): void {
    this.emit("message", { data: JSON.stringify({ type: "output", data }) });
  }
}

interface Recorder {
  caged: Caged;
  sockets: FakeWS[];
  urls: string[];
  protocols: string[][];
  ticketRequests: number;
}

function recorder(
  opts: { ticket?: boolean; baseUrl?: string; autoAnswer?: boolean } = {}
): Recorder {
  const rec: Recorder = {
    sockets: [],
    urls: [],
    protocols: [],
    ticketRequests: 0,
    caged: undefined as unknown as Caged,
  };
  rec.caged = new Caged({
    apiKey: "caged_sk_test",
    baseUrl: opts.baseUrl ?? "https://api.example.test",
    fetch: async (input) => {
      rec.ticketRequests++;
      expect(String(input)).toContain("/v1/auth/socket-ticket");
      if (opts.ticket === false) {
        return new Response("404 page not found", {
          status: 404,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(
        JSON.stringify({
          ticket: "caged_wst_abc.def",
          expires_in: 60,
          expires_at: "t",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    webSocket: (url, protocols) => {
      rec.urls.push(url);
      rec.protocols.push(protocols);
      const ws = new FakeWS();
      ws.autoAnswer = opts.autoAnswer ?? true;
      rec.sockets.push(ws);
      return ws;
    },
  });
  return rec;
}

describe("how the credential reaches a handshake", () => {
  it("sends a single-use ticket, not the API key", async () => {
    const rec = recorder();
    await rec.caged.sandboxes.terminal("sbx_1", { rows: 40, cols: 120 });
    const url = new URL(rec.urls[0]!);
    expect(url.searchParams.get("token")).toBe("caged_wst_abc.def");
    expect(rec.urls[0]).not.toContain("caged_sk_test");
    expect(url.searchParams.get("rows")).toBe("40");
    expect(url.searchParams.get("cols")).toBe("120");
  });

  it("turns https into wss", async () => {
    const rec = recorder();
    await rec.caged.sandboxes.mcp("sbx_1");
    expect(rec.urls[0]).toMatch(
      /^wss:\/\/api\.example\.test\/v1\/sandboxes\/sbx_1\/mcp\?/
    );
  });

  it("turns http into ws for local development", async () => {
    const rec = recorder({ baseUrl: "http://localhost:8080" });
    await rec.caged.sandboxes.mcp("sbx_1");
    expect(rec.urls[0]).toMatch(/^ws:\/\/localhost:8080\/v1\//);
  });

  it("asks for each endpoint's own subprotocol", async () => {
    const rec = recorder();
    await rec.caged.sandboxes.terminal("sbx_1");
    expect(rec.protocols[0]).toEqual(["terminal"]);
    await rec.caged.sandboxes.mcp("sbx_1");
    expect(rec.protocols[1]).toEqual(["mcp"]);
  });

  it("falls back to the key against an API without the ticket endpoint", async () => {
    // Otherwise a deployment older than POST /v1/auth/socket-ticket loses
    // every socket.
    const rec = recorder({ ticket: false });
    await rec.caged.sandboxes.terminal("sbx_1");
    const url = new URL(rec.urls[0]!);
    expect(url.searchParams.get("token")).toBe("caged_sk_test");
  });

  it("does not swallow a real refusal from the ticket endpoint", async () => {
    const caged = new Caged({
      apiKey: "caged_sk_test",
      baseUrl: "https://api.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify({ title: "Unauthorized", status: 401, detail: "invalid API key" }),
          { status: 401, headers: { "content-type": "application/problem+json" } }
        ),
      webSocket: () => new FakeWS(),
    });
    await expect(caged.sandboxes.terminal("sbx_1")).rejects.toThrowError(
      "invalid API key"
    );
  });

  it("explains itself when no WebSocket implementation is available", async () => {
    const caged = new Caged({
      apiKey: "caged_sk_test",
      fetch: async () => new Response("{}", { status: 404 }),
    });
    const globals = globalThis as { WebSocket?: unknown };
    const saved = globals.WebSocket;
    delete globals.WebSocket;
    try {
      await expect(caged.sandboxes.terminal("sbx_1")).rejects.toThrowError(
        /pass `webSocket`/
      );
    } finally {
      if (saved !== undefined) globals.WebSocket = saved;
    }
  });
});

describe("the marker protocol", () => {
  it("drops the banner and the shell echo", () => {
    const f = new MarkerFilter("BEGIN", "EXIT");
    const [out, done] = f.feed("Welcome to Ubuntu\nstty -echo; printf BEGIN\n");
    expect(out).toBe("");
    expect(done).toBe(false);
  });

  it("emits output and reads the exit code", () => {
    const f = new MarkerFilter("BEGIN", "EXIT");
    f.feed("banner\nBEGIN\n");
    const [out, done] = f.feed("hello world\nEXIT7\n");
    expect(out).toBe("hello world\n");
    expect(done).toBe(true);
    expect(f.exitCode).toBe(7);
  });

  it("survives a marker split across frames", () => {
    // A PTY read boundary can land in the middle of a marker, which is why
    // output is held back rather than emitted straight through.
    const f = new MarkerFilter("BEGIN", "EXIT");
    let collected = "";
    let done = false;
    for (const chunk of ["noise BEG", "IN\nreal output\n", "more\nEX", "IT0\n"]) {
      const [out, finished] = f.feed(chunk);
      collected += out;
      done = finished;
    }
    expect(done).toBe(true);
    expect(f.exitCode).toBe(0);
    expect(collected).toBe("real output\nmore\n");
  });

  it("waits for the exit digits", () => {
    const f = new MarkerFilter("BEGIN", "EXIT");
    f.feed("BEGIN\n");
    expect(f.feed("done\nEXIT")[1]).toBe(false);
    expect(f.exitCode).toBeNull();
    expect(f.feed("13\n")[1]).toBe(true);
    expect(f.exitCode).toBe(13);
  });

  it("flushes held-back output when the stream ends", () => {
    const f = new MarkerFilter("BEGIN", "EXIT");
    expect(f.feed("BEGIN\nshort\n")[0]).toBe("");
    expect(f.flush()).toBe("short\n");
  });

  it("does not flush a partial end marker as output", () => {
    const f = new MarkerFilter("BEGIN", "EXIT");
    f.feed("BEGIN\ndone\nEX");
    expect(f.flush()).toBe("done\n");
  });

  it("flushes nothing before the first marker", () => {
    const f = new MarkerFilter("BEGIN", "EXIT");
    f.feed("login banner\n");
    expect(f.flush()).toBe("");
  });
});

describe("ExecStream", () => {
  it("yields output and reports the exit code", async () => {
    const rec = recorder({ autoAnswer: false });
    const stream = await rec.caged.sandboxes.execStream("sbx_1", "npm test");
    const ws = rec.sockets[0]!;

    const lines = ws.sent.map((m) => (JSON.parse(m) as { data: string }).data);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("npm test\n");

    const begin = /'(__CAGED_BEGIN_[0-9a-f]+__)'/.exec(lines[0]!)![1]!;
    const end = /'(__CAGED_EXIT_[0-9a-f]+__)'/.exec(lines[2]!)![1]!;

    ws.output("Ubuntu 24.04 LTS\n");
    ws.output(`${begin}\n`);
    ws.output("2 passing\n");
    ws.output(`${end}1\n`);

    await expect(stream.text()).resolves.toBe("2 passing\n");
    expect(stream.exitCode).toBe(1);
    expect(ws.closed).toBe(true);
  });

  it("leaves the exit code unknown if the socket drops", async () => {
    // A dropped connection is not a successful command. Defaulting to 0
    // would report a pass for a run nobody saw finish.
    const rec = recorder({ autoAnswer: false });
    const stream = await rec.caged.sandboxes.execStream("sbx_1", "sleep 100");
    const ws = rec.sockets[0]!;
    const begin = /'(__CAGED_BEGIN_[0-9a-f]+__)'/.exec(
      (JSON.parse(ws.sent[0]!) as { data: string }).data
    )![1]!;

    ws.output(`${begin}\npartial`);
    ws.close();

    await expect(stream.text()).resolves.toBe("partial");
    expect(stream.exitCode).toBeNull();
  });

  it("passes a multi-line command through untouched", async () => {
    const rec = recorder({ autoAnswer: false });
    await rec.caged.sandboxes.execStream(
      "sbx_1",
      "for f in *.js; do\n  echo $f\ndone"
    );
    const lines = rec.sockets[0]!.sent.map(
      (m) => (JSON.parse(m) as { data: string }).data
    );
    expect(lines[1]).toBe("for f in *.js; do\n  echo $f\ndone\n");
  });
});

describe("TerminalSession", () => {
  it("delivers output frames to handlers", async () => {
    const rec = recorder({ autoAnswer: false });
    const terminal = await rec.caged.sandboxes.terminal("sbx_1");
    const seen: string[] = [];
    terminal.onOutput((data) => seen.push(data));
    rec.sockets[0]!.output("hello");
    expect(seen).toEqual(["hello"]);
  });

  it("sends input and resize frames in the protocol's shape", async () => {
    const rec = recorder({ autoAnswer: false });
    const terminal = await rec.caged.sandboxes.terminal("sbx_1");
    terminal.send("ls\n");
    terminal.resize(50, 160);
    expect(rec.sockets[0]!.sent.map((m) => JSON.parse(m))).toEqual([
      { type: "input", data: "ls\n" },
      { type: "resize", rows: 50, cols: 160 },
    ]);
  });

  it("refuses to send on a closed session", async () => {
    const rec = recorder({ autoAnswer: false });
    const terminal = await rec.caged.sandboxes.terminal("sbx_1");
    terminal.close();
    expect(terminal.closed).toBe(true);
    expect(() => terminal.send("ls\n")).toThrow(CagedError);
  });
});

describe("MCPClient", () => {
  it("initialises with the package version, not a hardcoded one", async () => {
    const rec = recorder();
    await rec.caged.sandboxes.mcp("sbx_1");
    const init = JSON.parse(rec.sockets[0]!.sent[0]!) as {
      method: string;
      params: { clientInfo: { version: string } };
    };
    expect(init.method).toBe("initialize");
    expect(init.params.clientInfo.version).toBe(VERSION);
  });

  it("returns an empty list when the server omits the array", async () => {
    // `result.tools` used to be returned unchecked, so a server that
    // answered `{}` handed the caller undefined typed as MCPTool[].
    const rec = recorder();
    const mcp = await rec.caged.sandboxes.mcp("sbx_1");
    await expect(mcp.listTools()).resolves.toEqual([]);
  });

  it("rejects pending requests when the socket closes", async () => {
    const rec = recorder({ autoAnswer: false });
    const connecting = rec.caged.sandboxes.mcp("sbx_1");
    // The ticket request and the handshake have to settle before a socket
    // exists at all; then initialize is in flight and can be dropped.
    while (rec.sockets.length === 0) await new Promise((r) => setTimeout(r, 1));
    rec.sockets[0]!.close();
    await expect(connecting).rejects.toBeInstanceOf(MCPError);
  });

  it("reports a tool error from the server", async () => {
    const rec = recorder({ autoAnswer: true });
    const mcp = await rec.caged.sandboxes.mcp("sbx_1");
    const ws = rec.sockets[0]!;
    ws.autoAnswer = false;
    const pending = mcp.callTool("terminal_exec", { command: "x" });
    const id = (JSON.parse(ws.sent[ws.sent.length - 1]!) as { id: number }).id;
    ws.emit("message", {
      data: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "no such tool" },
      }),
    });
    await expect(pending).rejects.toThrowError("no such tool");
  });
});
