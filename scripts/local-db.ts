import "dotenv/config";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
if (
  process.env.APP_ENV !== "development" ||
  process.env.LOCAL_PGLITE !== "true"
)
  throw new Error("PGlite is for synthetic local development only.");
const pg = await PGlite.create(".local/postgres");
await pg.exec("SET TIME ZONE 'UTC'");
const server = new PGLiteSocketServer({
  db: pg,
  host: "127.0.0.1",
  port: 5548,
  maxConnections: 20,
});
await server.start();
console.log(
  "Synthetic local PostgreSQL development server on 127.0.0.1:5548. Not a production service.",
);
async function stop() {
  await server.stop();
  await pg.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
