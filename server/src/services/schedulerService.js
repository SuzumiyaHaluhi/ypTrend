const cron = require("node-cron");
const { runPipeline } = require("./pipelineService");
const { getSettings } = require("./settingsService");

class SchedulerManager {
  constructor() {
    this.jobs = [];
  }

  stop() {
    this.jobs.forEach((j) => j.stop());
    this.jobs = [];
  }

  start() {
    this.stop();
    const settings = getSettings();

    const twitterExpr = `*/${settings.intervals.twitterMinutes} * * * *`;
    const webExpr = `*/${settings.intervals.webMinutes} * * * *`;
    const rssExpr = `*/${settings.intervals.rssMinutes} * * * *`;

    this.jobs.push(
      cron.schedule(twitterExpr, () => runPipeline({ source: "twitter" }).catch(() => {})),
      cron.schedule(webExpr, () => runPipeline({ source: "web" }).catch(() => {})),
      cron.schedule(rssExpr, () => runPipeline({ source: "rss" }).catch(() => {}))
    );
  }

  reload() {
    this.start();
  }
}

module.exports = {
  SchedulerManager
};
