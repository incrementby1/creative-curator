import { expect, test } from "@playwright/test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../proxy";

test("proxy matcher includes protected routes while session guard no-ops elsewhere", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  expect(matches("/")).toBe(false);
  expect(matches("/projects")).toBe(true);
  expect(matches("/settings")).toBe(true);
  expect(matches("/settings/providers")).toBe(true);
  expect(matches("/settings/providers/openai.json")).toBe(false);
  expect(matches("/login")).toBe(false);
  expect(matches("/api/creative/start")).toBe(false);
  expect(matches("/studio")).toBe(true);
});
