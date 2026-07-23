import { expect, test } from "@playwright/test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../proxy";

test("proxy runs only for protected workspace routes", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  expect(matches("/")).toBe(true);
  expect(matches("/settings")).toBe(true);
  expect(matches("/settings/providers")).toBe(true);
  expect(matches("/settings/providers/openai.json")).toBe(true);
  expect(matches("/login")).toBe(false);
  expect(matches("/api/creative/start")).toBe(false);
  expect(matches("/_next/static/chunk.js")).toBe(false);
  expect(matches("/favicon.ico")).toBe(false);
  expect(matches("/studio")).toBe(false);
});
