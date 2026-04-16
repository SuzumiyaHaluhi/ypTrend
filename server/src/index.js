const { config } = require("./config");
const { createApp } = require("./app");
const { SchedulerManager } = require("./services/schedulerService");
const { getSettings } = require("./services/settingsService");

const scheduler = new SchedulerManager();
const app = createApp({ scheduler });

getSettings();
scheduler.start();

app.listen(config.port, () => {
  console.log(`[ypTrend] server listening on http://localhost:${config.port}`);
});
