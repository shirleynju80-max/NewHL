import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATA_API_FETCH_TIMEOUT_MS,
  fetchApiCsvBundle,
} from "./dataBundle";

describe("fetchApiCsvBundle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts slow API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );
    await expect(
      fetchApiCsvBundle("https://example.test", 50),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(DATA_API_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
