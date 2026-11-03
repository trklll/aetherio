import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** Opt-in, network-dependent checks. Not part of the deterministic E2E suite. */
export default defineConfig({ ...base, testDir: "./smoke", timeout: 90_000 });
