import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.serverPort, "127.0.0.1", () => {
  console.log(`Invoice Intake server listening on http://127.0.0.1:${config.serverPort}`);
});
