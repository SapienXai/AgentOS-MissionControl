import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const sourcePath = path.join(repoRoot, "public", "assets", "pikoLoader.webm");
const outputPath = path.join(repoRoot, "public", "assets", "pikoLoader.hevc.mov");

if (process.platform !== "darwin") {
  throw new Error("HEVC alpha generation requires macOS VideoToolbox.");
}

await access(sourcePath);
const workRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-piko-hevc-"));
const sourceFrames = path.join(workRoot, "source");
const alphaFrames = path.join(workRoot, "alpha");
await mkdir(sourceFrames);
await mkdir(alphaFrames);

async function run(command, args) {
  await execFileAsync(command, args, { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
}

try {
  const { stdout: frameRateOutput } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=nw=1:nk=1", sourcePath],
    { cwd: repoRoot }
  );
  const frameRate = frameRateOutput.trim() || "24/1";
  const sourcePattern = path.join(sourceFrames, "frame-%04d.png");
  const alphaPattern = path.join(alphaFrames, "frame-%04d.png");

  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    sourcePath,
    "-an",
    "-vf",
    "format=rgba",
    "-vsync",
    "0",
    sourcePattern
  ]);

  const frames = (await readdir(sourceFrames))
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (frames.length === 0) {
    throw new Error("The Piko WebM did not produce any video frames.");
  }

  for (const frame of frames) {
    await run("magick", [
      path.join(sourceFrames, frame),
      "-alpha",
      "on",
      "-fuzz",
      "10%",
      "-fill",
      "none",
      "-draw",
      "color 0,0 floodfill",
      path.join(alphaFrames, frame)
    ]);
  }

  await run("ffmpeg", [
    "-y",
    "-v",
    "warning",
    "-framerate",
    frameRate,
    "-i",
    alphaPattern,
    "-an",
    "-c:v",
    "hevc_videotoolbox",
    "-pix_fmt",
    "bgra",
    "-alpha_quality",
    "0.9",
    "-tag:v",
    "hvc1",
    outputPath
  ]);

  console.log(`Generated ${path.relative(repoRoot, outputPath)} from ${frames.length} alpha-processed frames.`);
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
