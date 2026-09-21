import type { CagedConfig } from "../src/types";
import { Caged } from "../src/client";

export interface RecordedRequest {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string | null;
}

export interface StubResponse {
  status?: number;
  /** Serialized as JSON unless `text` is used. */
  json?: unknown;
  text?: string;
  contentType?: string;
}

export interface Harness {
  caged: Caged;
  requests: RecordedRequest[];
  /** The single request the call under test made. Fails loudly otherwise. */
  only(): RecordedRequest;
}

/**
 * Builds a client whose transport is a recording stub.
 *
 * `responses` is consumed in order; the last one repeats, so a single
 * entry answers every call.
 */
export function harness(
  responses: StubResponse[],
  config: Partial<CagedConfig> = {}
): Harness {
  const requests: RecordedRequest[] = [];
  let index = 0;

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const parsed = new URL(url);
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    requests.push({
      method: init?.method ?? "GET",
      url,
      path: parsed.pathname,
      query: parsed.searchParams,
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });

    const stub = responses[Math.min(index, responses.length - 1)];
    index++;
    const status = stub.status ?? 200;
    const contentType =
      stub.contentType ?? (stub.text !== undefined ? "text/plain; charset=utf-8" : "application/json");
    const body =
      stub.text !== undefined
        ? stub.text
        : stub.json === undefined
          ? ""
          : JSON.stringify(stub.json);
    return new Response(status === 204 ? null : body, {
      status,
      headers: { "content-type": contentType },
    });
  };

  const caged = new Caged({
    apiKey: "caged_sk_test",
    baseUrl: "https://api.example.test",
    fetch: fetchImpl,
    ...config,
  });

  return {
    caged,
    requests,
    only(): RecordedRequest {
      if (requests.length !== 1) {
        throw new Error(`expected exactly 1 request, got ${requests.length}`);
      }
      return requests[0]!;
    },
  };
}
