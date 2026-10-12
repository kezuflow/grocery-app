import { parseOptions, preflight } from "./native-driver.mjs";

try {
  const options = parseOptions(process.argv.slice(2));
  console.log(JSON.stringify({ status: "available", ...(await preflight(options)) }, null, 2));
} catch (error) {
  console.error(`Native prerequisites unavailable. ${error.message}`);
  process.exitCode = 1;
}
