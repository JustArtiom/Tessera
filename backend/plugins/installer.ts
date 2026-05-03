import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import { pluginManifestSchema } from "../types/plugin";
import { AppError } from "../middleware/error";
import { loadAll, pluginsRoot } from "./loader";

interface InstallResult {
  pluginId: string;
  reload: Awaited<ReturnType<typeof loadAll>>;
}

export async function installFromZip(buffer: Buffer): Promise<InstallResult> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  if (entries.length === 0) {
    throw new AppError(400, `Zip is empty`);
  }

  // Locate manifest.json inside the zip and use its directory as the plugin root.
  const manifestEntry = entries.find((e) => {
    const name = e.entryName.replace(/\\/g, `/`);
    return name.endsWith(`manifest.json`) && name.split(`/`).filter(Boolean).length <= 2;
  });
  if (!manifestEntry) {
    throw new AppError(400, `Zip is missing manifest.json at root or one level deep`);
  }

  let manifest;
  try {
    manifest = pluginManifestSchema.parse(JSON.parse(manifestEntry.getData().toString(`utf8`)));
  } catch (err) {
    throw new AppError(400, `Invalid manifest.json`, err instanceof Error ? err.message : err);
  }

  const manifestDirInZip = path.posix.dirname(manifestEntry.entryName.replace(/\\/g, `/`));
  const stripPrefix = manifestDirInZip === `.` ? `` : manifestDirInZip + `/`;

  const targetRoot = pluginsRoot();
  const targetDir = path.join(targetRoot, manifest.id);
  const targetDirResolved = path.resolve(targetDir);

  fs.mkdirSync(targetRoot, { recursive: true });
  // Replace any prior install of the same id.
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  let foundEntry = false;
  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, `/`);
    if (stripPrefix && !normalized.startsWith(stripPrefix)) continue;
    const relative = stripPrefix ? normalized.slice(stripPrefix.length) : normalized;
    if (!relative || relative.endsWith(`/`)) continue;

    const destPath = path.resolve(targetDir, relative);
    // zip-slip protection
    if (destPath !== targetDirResolved && !destPath.startsWith(targetDirResolved + path.sep)) {
      throw new AppError(400, `Zip entry escapes target directory: ${entry.entryName}`);
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, entry.getData());

    if (relative === `index.js` || relative === `index.cjs`) foundEntry = true;
  }

  if (!foundEntry) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new AppError(400, `Zip is missing index.js (or index.cjs) next to manifest.json`);
  }

  const reload = await loadAll();
  return { pluginId: manifest.id, reload };
}
