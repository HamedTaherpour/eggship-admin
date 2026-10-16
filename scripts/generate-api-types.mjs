import { contractPath, formatSummary, generatedPath, generateTypes, readContract } from "./api-contract.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { contract, summary } = await readContract();
const generated = await generateTypes(contract);

await mkdir(dirname(fileURLToPath(generatedPath)), { recursive: true });
await writeFile(generatedPath, generated, "utf8");

console.log(`Generated ${generatedPath.pathname} from ${contractPath.pathname}`);
console.log(formatSummary(summary));
