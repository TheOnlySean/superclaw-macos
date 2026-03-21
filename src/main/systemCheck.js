const os = require('os');
const { execSync } = require('child_process');
const path = require('path');

/** On macOS, when launched from Finder, PATH may not include /usr/local/bin; use login shell so pkg-installed node is visible. */
function runInLoginShellIfDarwin(cmd) {
  if (process.platform === 'darwin') {
    const shell = process.env.SHELL || '/bin/zsh';
    return execSync(`${shell} -l -c '${cmd.replace(/'/g, "'\\\\''")}'`, { encoding: 'utf8', timeout: 8000 });
  }
  return execSync(cmd, { encoding: 'utf8', timeout: 5000, env: process.env });
}

const NODE_MIN_MAJOR = 22;
const RAM_MIN_GB = 4;
const RAM_RECOMMENDED_GB = 8;
const DISK_MIN_GB = 10;
const DISK_RECOMMENDED_GB = 20;
const SCORE_NODE = 30;
const SCORE_RAM = 30;
const SCORE_DISK = 20;
const SCORE_OS = 20;
const PASS_THRESHOLD = 60;

function getNodeVersion() {
  try {
    const out = runInLoginShellIfDarwin('node -v');
    const match = out.trim().match(/v?(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

/** Whether npm is available (bundled with Node). Returns version string or null. */
function getNpmVersion() {
  try {
    const out = runInLoginShellIfDarwin('npm -v');
    return out.trim() || null;
  } catch {
    return null;
  }
}

function getFreeDiskGB() {
  try {
    const platform = process.platform;
    if (platform === 'darwin' || platform === 'linux') {
      const out = execSync('df -k .', { encoding: 'utf8', timeout: 5000 });
      const lines = out.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const avail = parseInt(parts[3], 10); // Available 1K blocks
        return Math.floor((avail * 1024) / (1024 * 1024 * 1024) * 10) / 10;
      }
    }
    if (platform === 'win32') {
      // wmic get size,freespace → columns are Size then FreeSpace (order as specified)
      const out = execSync('wmic logicaldisk get size,freespace', { encoding: 'utf8', timeout: 5000 });
      const lines = out.trim().split('\n').filter(Boolean);
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 2) {
          const free = parseInt(parts[1], 10); // parts[0]=Size, parts[1]=FreeSpace
          if (!isNaN(free)) return Math.floor(free / (1024 * 1024 * 1024) * 10) / 10;
        }
      }
    }
  } catch (e) {
    console.error('getFreeDiskGB', e.message);
  }
  return 0;
}

/** This app is distributed for Mac/Windows only; Linux is not supported. */
function getOSInfo() {
  const platform = process.platform;
  const release = os.release();
  if (platform === 'darwin') return { name: 'macOS', version: release, supported: true };
  if (platform === 'win32') return { name: 'Windows', version: release, supported: true };
  if (platform === 'linux') return { name: 'Linux', version: release, supported: false };
  return { name: platform, version: release, supported: false };
}

function run() {
  const nodeMajor = getNodeVersion();
  const npmVersion = getNpmVersion();
  const ramTotalGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
  const ramFreeGB = Math.floor(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
  const diskFreeGB = getFreeDiskGB();
  const osInfo = getOSInfo();

  let scoreNode = 0;
  if (nodeMajor >= NODE_MIN_MAJOR) scoreNode = SCORE_NODE;
  else if (nodeMajor > 0) scoreNode = Math.floor((nodeMajor / NODE_MIN_MAJOR) * SCORE_NODE);

  let scoreRAM = 0;
  if (ramTotalGB >= RAM_RECOMMENDED_GB) scoreRAM = SCORE_RAM;
  else if (ramTotalGB >= RAM_MIN_GB) scoreRAM = Math.floor((ramTotalGB / RAM_RECOMMENDED_GB) * SCORE_RAM);

  let scoreDisk = 0;
  if (diskFreeGB >= DISK_RECOMMENDED_GB) scoreDisk = SCORE_DISK;
  else if (diskFreeGB >= DISK_MIN_GB) scoreDisk = Math.floor((diskFreeGB / DISK_RECOMMENDED_GB) * SCORE_DISK);

  const scoreOS = osInfo.supported ? SCORE_OS : 0;
  const totalScore = scoreNode + scoreRAM + scoreDisk + scoreOS;
  // Pass threshold: no Xcode required; low score is informational only.
  const pass = totalScore >= PASS_THRESHOLD;

  return {
    node: {
      version: nodeMajor,
      required: NODE_MIN_MAJOR,
      score: scoreNode,
      maxScore: SCORE_NODE,
      ok: nodeMajor >= NODE_MIN_MAJOR,
    },
    npm: {
      available: npmVersion !== null,
      version: npmVersion,
    },
    ram: {
      totalGB: ramTotalGB,
      freeGB: ramFreeGB,
      minGB: RAM_MIN_GB,
      recommendedGB: RAM_RECOMMENDED_GB,
      score: scoreRAM,
      maxScore: SCORE_RAM,
      ok: ramTotalGB >= RAM_MIN_GB,
    },
    disk: {
      freeGB: diskFreeGB,
      minGB: DISK_MIN_GB,
      recommendedGB: DISK_RECOMMENDED_GB,
      score: scoreDisk,
      maxScore: SCORE_DISK,
      ok: diskFreeGB >= DISK_MIN_GB,
    },
    os: {
      ...osInfo,
      expectedClient: process.platform,
      score: scoreOS,
      maxScore: SCORE_OS,
    },
    totalScore,
    maxScore: SCORE_NODE + SCORE_RAM + SCORE_DISK + SCORE_OS,
    pass,
  };
}

module.exports = { run };
