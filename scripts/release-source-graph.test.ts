import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import packageJson from "../package.json";

it("type-checks the release using only source files available in a Git checkout", () => {
  const root = process.cwd();
  const normalize = (file: string) => path.resolve(file).replaceAll("\\", "/").toLowerCase();
  const sourceRoot = `${normalize(path.join(root, "src"))}/`;
  const tracked = new Set(execFileSync("git", ["ls-files", "-z", "--", "src"], { encoding: "utf8" })
    .split("\0").filter(Boolean).map(file => normalize(path.join(root, file))));
  const available = (file: string) => !normalize(file).startsWith(sourceRoot) || tracked.has(normalize(file));
  const configName = /tsc\s+-p\s+(\S+)/.exec(packageJson.scripts.build)?.[1] ?? "tsconfig.json";
  const config = ts.readConfigFile(path.join(root, configName), ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile;
  const fileExists = host.fileExists;
  host.readFile = file => available(file) ? readFile(file) : undefined;
  host.fileExists = file => available(file) && fileExists(file);
  const program = ts.createProgram(parsed.fileNames.filter(available), parsed.options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  const messages = errors.slice(0, 12).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  expect(messages, `${errors.length} release type errors in a clean checkout`).toEqual([]);
}, 60_000);
