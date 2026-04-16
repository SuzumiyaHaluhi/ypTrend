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

async function fetchFromTwitter(query, limit = 8, qualityOverrides = {}) {
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

      const tweets = flattenTweets(response.data);
      const mergedQualityOptions = {
        minEngagementScore: config.twitterMinEngagementScore,
        replyMinEngagementScore: config.twitterReplyMinEngagementScore,
        minFollowers: config.twitterMinFollowers,
        excludeRetweets: config.twitterExcludeRetweets,
        ...qualityOverrides
      };
      const qualityOptions = {
        minEngagementScore: toNumber(mergedQualityOptions.minEngagementScore),
        replyMinEngagementScore: toNumber(mergedQualityOptions.replyMinEngagementScore),
        minFollowers: toNumber(mergedQualityOptions.minFollowers),
        excludeRetweets: Boolean(mergedQualityOptions.excludeRetweets)
      };

      const filtered = [];
      for (const tweet of tweets) {
        const quality = evaluateTweetQuality(tweet, qualityOptions);
        if (!quality.keep) continue;

        const authorName = tweet.user?.name || tweet.author?.name || tweet.user?.screen_name || "Unknown";
        const text = String(tweet.text || tweet.full_text || "").trim();
        const url = tweet.url || tweet.twitterUrl || (tweet.id_str ? `https://x.com/i/status/${tweet.id_str}` : null);
        if (!url) continue;

        filtered.push({
          source: "twitter",
          sourceId: String(tweet.id || tweet.tweet_id || ""),
          title: `${authorName}: ${text}`.slice(0, 200),
          url,
          summary: text,
          publishedAt: tweet.created_at || tweet.createdAt || null,
          trustLevel: quality.trustLevel,
          raw: {
            ...tweet,
            quality
          }
        });

        if (filtered.length >= limit) break;
      }

      return filtered;
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

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function extractAuthor(tweet) {
  const user = tweet.user || tweet.author || {};
  return {
    followers: toNumber(
      user.followers_count ??
      user.followersCount ??
      user.follower_count ??
      user.followers
    ),
    verified: Boolean(user.verified ?? user.is_verified ?? user.blue_verified),
    username: user.screen_name || user.username || user.userName || "",
    name: user.name || user.displayName || ""
  };
}

function extractMetrics(tweet) {
  return {
    likes: toNumber(tweet.favorite_count ?? tweet.favorites ?? tweet.like_count ?? tweet.likeCount ?? tweet.likes),
    retweets: toNumber(tweet.retweet_count ?? tweet.retweetCount ?? tweet.reposts ?? tweet.retweet),
    quotes: toNumber(tweet.quote_count ?? tweet.quoteCount ?? tweet.quotes),
    replies: toNumber(tweet.reply_count ?? tweet.replyCount ?? tweet.comments),
    views: toNumber(
      tweet.view_count ??
      tweet.views ??
      tweet.viewCount ??
      tweet.impression_count ??
      tweet.impressions ??
      tweet.public_metrics?.impression_count
    )
  };
}

function isReplyTweet(tweet) {
  if (tweet.in_reply_to_status_id || tweet.inReplyToStatusId || tweet.inReplyToTweetId) return true;
  if (tweet.in_reply_to_user_id || tweet.inReplyToUserId) return true;
  if (Array.isArray(tweet.referenced_tweets) && tweet.referenced_tweets.some((x) => x?.type === "replied_to")) return true;
  const text = String(tweet.text || tweet.full_text || "").trim();
  return /^@\w+/.test(text);
}

function isRetweetTweet(tweet) {
  if (tweet.retweeted_status || tweet.retweetedStatus) return true;
  if (Array.isArray(tweet.referenced_tweets) && tweet.referenced_tweets.some((x) => x?.type === "retweeted")) return true;
  const text = String(tweet.text || tweet.full_text || "").trim();
  return /^RT\s+@/i.test(text);
}

function isQuoteTweet(tweet) {
  if (tweet.is_quote_status || tweet.isQuoteStatus) return true;
  if (tweet.quoted_status_id || tweet.quotedStatusId || tweet.quoted_tweet_id || tweet.quotedTweetId) return true;
  if (tweet.quoted_status || tweet.quotedStatus) return true;
  return Array.isArray(tweet.referenced_tweets) && tweet.referenced_tweets.some((x) => x?.type === "quoted");
}

function calculateEngagementScore(metrics) {
  return (
    (metrics.likes * 1.5) +
    (metrics.retweets * 2) +
    (metrics.quotes * 2) +
    metrics.replies +
    (metrics.views / 100)
  );
}

function resolveEngagementTier(engagementScore) {
  if (engagementScore >= 2000) return "high";
  if (engagementScore >= 500) return "medium";
  return "low";
}

function evaluateTweetQuality(tweet, options) {
  const metrics = extractMetrics(tweet);
  const author = extractAuthor(tweet);
  const text = String(tweet.text || tweet.full_text || "").trim();
  const engagementScore = Number(calculateEngagementScore(metrics).toFixed(2));
  const engagementTier = resolveEngagementTier(engagementScore);
  const isReply = isReplyTweet(tweet);
  const isRetweet = isRetweetTweet(tweet);
  const isQuote = isQuoteTweet(tweet);

  if (isReply || isQuote || isRetweet) {
    const reason = isReply ? "reply_not_original" : isQuote ? "quote_not_original" : "retweet_not_original";
    return {
      keep: false,
      reason,
      trustLevel: "low",
      engagementScore,
      engagementTier,
      isOriginal: false,
      isReply,
      isQuote,
      isRetweet,
      ...metrics,
      ...author
    };
  }

  if (!text || (text.length < 18 && engagementScore < options.minEngagementScore)) {
    return {
      keep: false,
      reason: "low_content_signal",
      trustLevel: "low",
      engagementScore,
      engagementTier,
      isOriginal: true,
      isReply,
      isQuote,
      isRetweet,
      ...metrics,
      ...author
    };
  }

  if (
    engagementScore < options.minEngagementScore &&
    !author.verified &&
    author.followers < options.minFollowers
  ) {
    return {
      keep: false,
      reason: "low_engagement_and_low_authority",
      trustLevel: "low",
      engagementScore,
      engagementTier,
      isOriginal: true,
      isReply,
      isQuote,
      isRetweet,
      ...metrics,
      ...author
    };
  }

  let trustLevel = "low";
  if (
    author.verified ||
    author.followers >= options.minFollowers * 5 ||
    engagementTier === "high"
  ) {
    trustLevel = "high";
  } else if (author.followers >= options.minFollowers || engagementTier === "medium") {
    trustLevel = "medium";
  }

  return {
    keep: true,
    reason: "passed",
    trustLevel,
    engagementScore,
    engagementTier,
    isOriginal: true,
    isReply,
    isQuote,
    isRetweet,
    ...metrics,
    ...author
  };
}

module.exports = {
  fetchFromTwitter,
  __test: {
    isReplyTweet,
    isQuoteTweet,
    isRetweetTweet,
    calculateEngagementScore,
    resolveEngagementTier,
    evaluateTweetQuality
  }
};
