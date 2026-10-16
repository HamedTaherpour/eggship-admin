import { contractPath, formatSummary, generatedPath, generateTypes, readContract } from "./api-contract.mjs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputPath = outputArgument ? pathToFileURL(outputArgument.slice("--output=".length)) : generatedPath;
const { contract, summary } = await readContract();
const expected = await generateTypes(contract);

let actual;
try {
  actual = await readFile(outputPath, "utf8");
} catch (error) {
  console.error(`Generated API types are missing at ${outputPath.pathname}. Run pnpm api:generate.`);
  process.exitCode = 1;
  throw error;
}

if (actual !== expected) {
  console.error(`Generated API types are stale at ${outputPath.pathname}. Run pnpm api:generate.`);
  process.exitCode = 1;
} else {
  console.log(`API contract and generated types are in sync: ${contractPath.pathname}`);
  console.log(formatSummary(summary));
}
