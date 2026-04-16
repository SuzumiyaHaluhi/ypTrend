const { z } = require("zod");

const createMonitorSchema = z.object({
  type: z.enum(["keyword", "scope"]),
  query: z.string().min(1)
});

const updateMonitorSchema = z.object({
  enabled: z.boolean().optional(),
  query: z.string().min(1).optional(),
  type: z.enum(["keyword", "scope"]).optional()
});

const updateSettingsSchema = z.object({
  intervals: z.object({
    twitterMinutes: z.number().int().min(1).max(120).optional(),
    webMinutes: z.number().int().min(1).max(120).optional(),
    rssMinutes: z.number().int().min(1).max(120).optional()
  }).optional(),
  limits: z.object({
    perSource: z.number().int().min(1).max(30).optional()
  }).optional(),
  notification: z.object({
    feishuWebhook: z.string().url().optional(),
    feishuKeyword: z.string().min(1).optional()
  }).optional()
});

module.exports = {
  createMonitorSchema,
  updateMonitorSchema,
  updateSettingsSchema
};
