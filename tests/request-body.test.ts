import { describe, expect, it } from "vitest";
import {
  boundedBody,
  boundedJson,
  boundedFormData,
} from "../src/lib/request-body";

describe("bounded request bodies", () => {
  it("accepts exactly the byte limit and validates JSON", async () => {
    expect(
      await boundedJson(
        new Request("http://localhost", { method: "POST", body: '{"x":1}' }),
        7,
      ),
    ).toEqual({ x: 1 });
  });
  it("blocks an oversized chunked stream without trusting Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://localhost", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(boundedBody(request, 7)).rejects.toMatchObject({
      status: 413,
    });
    expect(cancelled).toBe(true);
  });
  it("rejects declared excessive bytes and malformed JSON without internal errors", async () => {
    await expect(
      boundedBody(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Length": "100" },
          body: "x",
        }),
        9,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      boundedJson(
        new Request("http://localhost", { method: "POST", body: "{" }),
        9,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("parses bounded multipart files and rejects malformed forms", async () => {
    const form = new FormData();
    form.set("file", new File(["abc"], "file.csv"));
    const parsed = await boundedFormData(
      new Request("http://localhost", { method: "POST", body: form }),
      2000,
    );
    expect(await (parsed.get("file") as File).text()).toBe("abc");
    await expect(
      boundedFormData(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "multipart/form-data" },
          body: "abc",
        }),
        9,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
