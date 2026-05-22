import type { Landmark, HandFrame } from "./types";

// Port of LandmarkPreprocessor.cs — normalizes landmarks to wrist-centered
// unit space and concatenates primary + secondary into 84 floats.
export function preprocessLandmarks(frame: HandFrame): Float32Array {
  const features = new Float32Array(84);

  const primary = normalize(frame.landmarks);
  for (let i = 0; i < 42; i++) features[i] = primary[i];

  if (frame.secondaryLandmarks) {
    const secondary = normalize(frame.secondaryLandmarks);
    for (let i = 0; i < 42; i++) features[42 + i] = secondary[i];
  }

  return features;
}

function normalize(landmarks: Landmark[]): number[] {
  if (!landmarks || landmarks.length < 21) return new Array(42).fill(0);

  const wrist = landmarks[0];
  const middleMcp = landmarks[9];

  const dx = middleMcp.x - wrist.x;
  const dy = middleMcp.y - wrist.y;
  const scale = Math.sqrt(dx * dx + dy * dy) || 1;

  const out: number[] = [];
  for (let i = 0; i < 21; i++) {
    out.push((landmarks[i].x - wrist.x) / scale);
    out.push((landmarks[i].y - wrist.y) / scale);
  }
  return out;
}
