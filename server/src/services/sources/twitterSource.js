const axios = require("axios");
const { config } = require("../../config");

function flattenTweets(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.tweets)) return data.tweets;
  if (Array.isArray(data.data)) return data.data;
  if (data.data && Array.isArray(data.data.tweets)) return data.data.tweets;
  if (data.result && Array.isArray(data.result.tweets)) return data.result.tweets;
  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromTwitter(query, limit = 8) {
  if (!config.twitterApiKey) {
    return [];
  }

  // Verified on 2026-04-15 via live probe.
  const endpoint = "/twitter/tweet/advanced_search";
  const paramsList = [
    { query, queryType: "Latest" },
    { query }
  ];

  let lastError = null;
  for (const params of paramsList) {
    try {
      const response = await axios.get(`${config.twitterApiBaseUrl}${endpoint}`, {
        timeout: config.requestTimeoutMs,
        proxy: false,
        headers: {
          "X-API-Key": config.twitterApiKey
        },
        params
      });

      const tweets = flattenTweets(response.data).slice(0, limit);
      return tweets.map((tweet) => ({
        source: "twitter",
        sourceId: String(tweet.id || tweet.tweet_id || ""),
        title: `${tweet.user?.name || tweet.author?.name || "Unknown"}: ${tweet.text || ""}`.slice(0, 200),
        url: tweet.url || tweet.twitterUrl || (tweet.id_str ? `https://x.com/i/status/${tweet.id_str}` : null),
        summary: tweet.text || "",
        publishedAt: tweet.created_at || tweet.createdAt || null,
        raw: tweet
      })).filter((x) => x.url);
    } catch (error) {
      const status = error.response?.status;
      const rawText = typeof error.response?.data === "string" ? error.response.data : JSON.stringify(error.response?.data || {});
      const qpsLimited = status === 429 || /Too Many Requests|QPS limit/i.test(rawText);
      if (qpsLimited) {
        await sleep(5200);
      }
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}

module.exports = { fetchFromTwitter };
