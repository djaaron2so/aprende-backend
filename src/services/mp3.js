import { spawn } from "child_process";
import fs from "fs";

export function wavToMp3(wavPath, mp3Path) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(mp3Path)) return resolve(mp3Path);

    const args = ["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "192k", mp3Path];
    const p = spawn("ffmpeg", args, { windowsHide: true });

    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));

    p.on("close", (code) => {
      if (code === 0) return resolve(mp3Path);
      reject(new Error(`ffmpeg failed (code ${code}): ${err.slice(-600)}`));
    });
  });
}
