import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = join(import.meta.dirname, "..", "src", "assets", "stream-tags");

const BADGES = [
  // Video codecs
  { id: "codec-h264", label: "H.264", color: "#2563eb", category: "video" },
  { id: "codec-h265", label: "H.265", color: "#7c3aed", category: "video" },
  { id: "codec-hevc", label: "HEVC", color: "#6d28d9", category: "video" },
  { id: "codec-av1", label: "AV1", color: "#059669", category: "video" },
  { id: "codec-avc", label: "AVC", color: "#0891b2", category: "video" },
  { id: "codec-mpeg4", label: "MPEG-4", color: "#6366f1", category: "video" },
  { id: "codec-vp9", label: "VP9", color: "#dc2626", category: "video" },

  // Audio codecs
  { id: "codec-aac", label: "AAC", color: "#d97706", category: "audio" },
  { id: "codec-flac", label: "FLAC", color: "#ea580c", category: "audio" },
  { id: "codec-opus", label: "Opus", color: "#c026d3", category: "audio" },
  { id: "codec-vorbis", label: "Vorbis", color: "#9333ea", category: "audio" },
  { id: "codec-mp3", label: "MP3", color: "#0284c7", category: "audio" },

  // Resolutions
  { id: "resolution-480p", label: "480p", color: "#64748b", category: "video" },
  { id: "resolution-576p", label: "576p", color: "#64748b", category: "video" },
  { id: "resolution-360p", label: "360p", color: "#64748b", category: "video" },
  { id: "fhd", label: "FHD", color: "#0d9488", category: "video" },
  { id: "uhd", label: "UHD", color: "#0891b2", category: "video" },

  // Channels
  { id: "channels-2.0", label: "2.0", color: "#78716c", category: "channels" },
  { id: "channels-mono", label: "Mono", color: "#78716c", category: "channels" },
];

const WIDTH = 56;
const HEIGHT = 20;
const FONT_SIZE = 11;

function generateBadgePNG({ id, label, color }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = color;
  ctx.beginPath();
  const r = 4;
  ctx.moveTo(r, 0);
  ctx.lineTo(WIDTH - r, 0);
  ctx.quadraticCurveTo(WIDTH, 0, WIDTH, r);
  ctx.lineTo(WIDTH, HEIGHT - r);
  ctx.quadraticCurveTo(WIDTH, HEIGHT, WIDTH - r, HEIGHT);
  ctx.lineTo(r, HEIGHT);
  ctx.quadraticCurveTo(0, HEIGHT, 0, HEIGHT - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${FONT_SIZE}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, WIDTH / 2, HEIGHT / 2 + 1);

  const buffer = canvas.toBuffer("image/png");
  return buffer;
}

// Generate all badges
let created = 0;
for (const badge of BADGES) {
  const filename = `${badge.id}.png`;
  const filepath = join(OUTPUT_DIR, filename);
  const png = generateBadgePNG(badge);
  writeFileSync(filepath, png);
  console.log(`Created: ${filename} (${png.length} bytes)`);
  created++;
}

console.log(`\nDone! Generated ${created} badge PNGs.`);
