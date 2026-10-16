import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";

import { readFile } from "node:fs/promises";

export const contractPath = new URL("../contracts/eggship-backend.openapi.json", import.meta.url);
export const generatedPath = new URL("../src/generated/api-types.ts", import.meta.url);

const operationMethods = new Set(["delete", "get", "head", "options", "patch", "post", "put", "trace"]);

export async function readContract() {
  let contract;

  try {
    contract = JSON.parse(await readFile(contractPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read or parse ${contractPath.pathname}: ${error.message}`, { cause: error });
  }

  if (!contract || typeof contract !== "object") {
    throw new Error("The OpenAPI contract must be a JSON object.");
  }

  if (typeof contract.openapi !== "string" || !/^3\.0(?:\.\d+)?$/.test(contract.openapi)) {
    throw new Error(`Expected an OpenAPI 3.0.x document; received ${String(contract.openapi)}.`);
  }

  if (!contract.paths || typeof contract.paths !== "object" || Array.isArray(contract.paths)) {
    throw new Error("The OpenAPI contract must define a paths object.");
  }

  const operations = Object.entries(contract.paths).flatMap(([path, pathItem]) =>
    Object.keys(pathItem ?? {})
      .filter((method) => operationMethods.has(method))
      .map((method) => ({ method: method.toUpperCase(), path })),
  );
  const adminOperations = operations.filter(({ path }) => path.startsWith("/api/v1/admin"));

  if (operations.length === 0) {
    throw new Error("The OpenAPI contract must define at least one operation.");
  }

  if (adminOperations.length === 0) {
    throw new Error("The OpenAPI contract must cover at least one /api/v1/admin operation.");
  }

  return {
    contract,
    summary: {
      openapi: contract.openapi,
      pathCount: Object.keys(contract.paths).length,
      operationCount: operations.length,
      adminOperationCount: adminOperations.length,
      adminPathCount: new Set(adminOperations.map(({ path }) => path)).size,
    },
  };
}

export async function generateTypes(contract) {
  const ast = await openapiTS(contract);
  return `${COMMENT_HEADER}${astToString(ast)}`;
}

export function formatSummary(summary) {
  return [
    `OpenAPI version: ${summary.openapi}`,
    `Paths: ${summary.pathCount}`,
    `Operations: ${summary.operationCount}`,
    `Admin paths: ${summary.adminPathCount}`,
    `Admin operations: ${summary.adminOperationCount}`,
  ].join("\n");
}
