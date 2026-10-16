import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);
const contract = JSON.parse(await readFile(new URL("contracts/eggship-backend.openapi.json", root), "utf8"));
const generated = fileURLToPath(new URL("src/generated/api-types.ts", root));
const checkScript = fileURLToPath(new URL("scripts/check-api-contract.mjs", root));

test("contract generation validates the supplied snapshot and reports Admin coverage", async () => {
  const { stdout } = await run("node", [checkScript]);

  assert.match(stdout, /OpenAPI version: 3\.0\.0/);
  assert.match(stdout, /Operations: 133/);
  assert.match(stdout, /Admin operations: 102/);
});

test("contract drift detection fails for stale generated types without changing the repository output", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "eggship-api-contract-"));
  const tempOutput = join(tempDirectory, "api-types.ts");

  try {
    await cp(generated, tempOutput);
    await writeFile(tempOutput, `${await readFile(tempOutput, "utf8")}\n// stale`, "utf8");

    await assert.rejects(run("node", [checkScript, `--output=${tempOutput}`]), /stale/i);
    assert.match(await readFile(tempOutput, "utf8"), /\/\/ stale/);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("CSRF bootstrap responses expose typed tokens for customer and Admin auth", async () => {
  for (const path of ["/api/v1/auth/csrf", "/api/v1/admin/auth/csrf"]) {
    const response = contract.paths[path].get.responses["200"];

    assert.equal(response.content["application/json"].schema.$ref, "#/components/schemas/CsrfTokenResponseDto");
  }

  assert.equal(contract.components.schemas.CsrfTokenDataDto.properties.token.type, "string");

  const generatedSource = await readFile(generated, "utf8");
  assert.match(
    generatedSource,
    /Auth_csrf:[\s\S]*?200:[\s\S]*?"application\/json": components\["schemas"\]\["CsrfTokenResponseDto"\]/,
  );
  assert.match(
    generatedSource,
    /AdminAuth_csrf:[\s\S]*?200:[\s\S]*?"application\/json": components\["schemas"\]\["CsrfTokenResponseDto"\]/,
  );
  assert.match(generatedSource, /CsrfTokenDataDto:[\s\S]*?token: string;/);

  for (const operation of [
    "AdminAuth_login",
    "AdminAuth_me",
    "AdminAuth_refresh",
    "AdminAuth_logout",
    "AdminAuth_logoutAll",
  ]) {
    assert.match(generatedSource, new RegExp(`${operation}: \\{`));
  }
});
