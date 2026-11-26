const os = require('os');
const express = require('express');
const config = require('../shared/config');
const db = require('../shared/db');
const redis = require('../shared/redis');
const { getConnectorLiveTelemetry } = require('../core/routingEngine');

const router = express.Router();

let cachedAwsAz = null;

async function resolveAvailabilityZone() {
  if (cachedAwsAz) return cachedAwsAz;
  if (process.env.AWS_AVAILABILITY_ZONE) {
    cachedAwsAz = process.env.AWS_AVAILABILITY_ZONE;
    return cachedAwsAz;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 250);
  try {
    const tokenRes = await fetch('http://169.254.169.254/latest/api/token', {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
      signal: controller.signal,
    });
    if (tokenRes.ok) {
      const token = await tokenRes.text();
      const azRes = await fetch('http://169.254.169.254/latest/meta-data/placement/availability-zone', {
        headers: { 'X-aws-ec2-metadata-token': token },
        signal: controller.signal,
      });
      if (azRes.ok) {
        cachedAwsAz = (await azRes.text()).trim();
        return cachedAwsAz;
      }
    }
  } catch (_) {
    // Fallback cleanly outside EC2/EKS
  } finally {
    clearTimeout(timer);
  }

  cachedAwsAz = config.awsAvailabilityZone || 'local-dev-az';
  return cachedAwsAz;
}

router.get('/', async (req, res) => {
  let dbLatencyMs = null;
  let dbHealthy = false;
  let redisLatencyMs = null;
  let redisHealthy = false;

  try {
    dbLatencyMs = await db.pingDatabase();
    dbHealthy = true;
  } catch (_) {
    dbHealthy = false;
  }

  try {
    redisLatencyMs = await redis.pingRedis();
    redisHealthy = true;
  } catch (_) {
    redisHealthy = false;
  }

  const availabilityZone = await resolveAvailabilityZone();
  const mode = req.query.mode === 'live' ? 'live' : 'test';
  const connectors = await getConnectorLiveTelemetry(mode).catch(() => ({}));

  const overallStatus = dbHealthy && redisHealthy ? 'operational' : 'degraded';

  res.status(overallStatus === 'operational' ? 200 : 503).json({
    platform: 'PayOps',
    status: overallStatus,
    hostname: os.hostname(),
    region: config.awsRegion,
    availability_zone: availabilityZone,
    git_commit_sha: config.gitCommitSha,
    jenkins_build_number: config.jenkinsBuildNumber,
    node_env: config.env,
    uptime_seconds: Math.floor(process.uptime()),
    dependencies: {
      postgresql: { healthy: dbHealthy, latency_ms: dbLatencyMs },
      redis: { healthy: redisHealthy, latency_ms: redisLatencyMs },
    },
    connectors,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
