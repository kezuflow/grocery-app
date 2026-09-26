import { readFile, readdir } from "node:fs/promises";

const agentsRoot = new URL("../.agents/skills/", import.meta.url);
const hermesRoot = new URL("../.hermes/skills/", import.meta.url);

async function files(root, directory = "") {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await files(root, `${path}/`)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

const agentsFiles = await files(agentsRoot);
const hermesFiles = await files(hermesRoot);
if (JSON.stringify(agentsFiles) !== JSON.stringify(hermesFiles)) {
  throw new Error("The .agents and .hermes skill file lists differ");
}
for (const path of agentsFiles) {
  const [agentsContent, hermesContent] = await Promise.all([
    readFile(new URL(path, agentsRoot)),
    readFile(new URL(path, hermesRoot)),
  ]);
  if (!agentsContent.equals(hermesContent)) {
    throw new Error(`Skill mirror differs: ${path}`);
  }
}
console.log(`Skill mirrors verified: ${agentsFiles.length} identical files.`);
