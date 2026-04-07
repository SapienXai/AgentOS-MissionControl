const fs = require("node:fs");

if (process.platform !== "win32") {
  return;
}

const suppressedPaths = new Set();
const retryableCodes = new Set(["EACCES", "ENOTDIR", "EPERM"]);
const originalReaddir = fs.readdir.bind(fs);
const originalReaddirSync = fs.readdirSync.bind(fs);
const originalPromisesReaddir = fs.promises.readdir.bind(fs.promises);

fs.readdir = function patchedReaddir(targetPath, ...args) {
  const callback = typeof args.at(-1) === "function" ? args.at(-1) : null;

  if (!callback) {
    return originalReaddir(targetPath, ...args);
  }

  args[args.length - 1] = (error, entries) => {
    if (shouldSuppressReaddirError(targetPath, error)) {
      logSuppressedPath(targetPath, error.code);
      callback(null, []);
      return;
    }

    callback(error, entries);
  };

  return originalReaddir(targetPath, ...args);
};

fs.readdirSync = function patchedReaddirSync(targetPath, ...args) {
  try {
    return originalReaddirSync(targetPath, ...args);
  } catch (error) {
    if (shouldSuppressReaddirError(targetPath, error)) {
      logSuppressedPath(targetPath, error.code);
      return [];
    }

    throw error;
  }
};

fs.promises.readdir = async function patchedPromisesReaddir(targetPath, ...args) {
  try {
    return await originalPromisesReaddir(targetPath, ...args);
  } catch (error) {
    if (shouldSuppressReaddirError(targetPath, error)) {
      logSuppressedPath(targetPath, error.code);
      return [];
    }

    throw error;
  }
};

function shouldSuppressReaddirError(targetPath, error) {
  if (!error || typeof error !== "object" || !retryableCodes.has(error.code)) {
    return false;
  }

  const resolvedPath = normalizePathValue(targetPath);

  if (!resolvedPath) {
    return false;
  }

  const normalizedPath = resolvedPath.replace(/\//g, "\\").toLowerCase();
  return normalizedPath.includes("\\microsoft\\windowsapps\\") || normalizedPath.endsWith(".exe");
}

function normalizePathValue(targetPath) {
  if (typeof targetPath === "string") {
    return targetPath;
  }

  if (targetPath instanceof Buffer) {
    return targetPath.toString();
  }

  return null;
}

function logSuppressedPath(targetPath, errorCode) {
  const resolvedPath = normalizePathValue(targetPath);

  if (!resolvedPath || suppressedPaths.has(resolvedPath)) {
    return;
  }

  suppressedPaths.add(resolvedPath);
  console.warn(`Suppressed readdir ${errorCode} for non-directory path: ${resolvedPath}`);
}
