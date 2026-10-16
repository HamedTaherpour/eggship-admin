import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("EggShip bootstrap identity is configured", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const appConfig = await readFile(new URL("src/config/app-config.ts", root), "utf8");
  const rootRoute = await readFile(new URL("src/routes/__root.tsx", root), "utf8");

  assert.equal(packageJson.name, "eggship-admin");
  assert.match(appConfig, /name: "EggShip Admin"/);
  assert.match(rootRoute, /lang="fa"/);
  assert.match(rootRoute, /dir="rtl"/);
});

test("demo auth does not expose submitted credentials", async () => {
  const loginForm = await readFile(new URL("src/routes/(main)/auth/-components/login-form.tsx", root), "utf8");
  const registerForm = await readFile(new URL("src/routes/(main)/auth/-components/register-form.tsx", root), "utf8");

  assert.doesNotMatch(loginForm, /JSON\.stringify\(data/);
  assert.doesNotMatch(registerForm, /JSON\.stringify\(data/);
});
