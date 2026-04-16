const { EventEmitter } = require("node:events");

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

module.exports = { eventBus };
