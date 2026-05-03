import { env } from "./config/env";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import configRoutes from "./routes/config";
import healthRoutes from "./routes/health";
import pluginRoutes from "./routes/plugins";
import downloadsRoutes from "./routes/downloads";
import libraryRoutes from "./routes/library";
import searchRoutes from "./routes/search";
import { downloadManager } from "./services/download-manager";
import { errorHandler, notFound } from "./middleware/error";
import { loadAll } from "./plugins/loader";
import { mountFrontend } from "./static";

const app = express();

app.set(`trust proxy`, 1);
if (env.NODE_ENV === `development`) {
  app.use(cors({ origin: true, credentials: true }));
}
app.use(express.json({ limit: `1mb` }));

app.use(`/api/health`, healthRoutes);
app.use(`/api/config`, configRoutes);
app.use(`/api/auth`, authRoutes);
app.use(`/api/plugins`, pluginRoutes);
app.use(`/api/search`, searchRoutes);
app.use(`/api/downloads`, downloadsRoutes);
app.use(`/api/library`, libraryRoutes);

if (env.NODE_ENV === `production`) {
  mountFrontend(app);
}

app.use(`/api`, notFound);
app.use(errorHandler);

async function bootstrap() {
  const report = await loadAll();
  console.log(
    `[plugins] loaded ${report.loaded.length}: ${report.loaded.join(`, `) || `(none)`}` +
      (report.failed.length ? ` | failed ${report.failed.length}` : ``),
  );
  for (const f of report.failed) {
    console.error(`[plugins] failed to load ${f.dir}: ${f.error}`);
  }

  const resumed = await downloadManager.resumeAll();
  if (resumed) console.log(`[downloads] resuming ${resumed} active download(s)`);
  const hlsChecked = await downloadManager.ensureHlsForCompleted();
  if (hlsChecked) console.log(`[downloads] checked HLS state for ${hlsChecked} completed download(s)`);

  app.listen(env.PORT, () => {
    console.log(`Tessera listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
}

bootstrap().catch((err) => {
  console.error(`[bootstrap] fatal`, err);
  process.exit(1);
});
