// Aspect-ratio handling for the gpt-image Codex bridge (Grillfuerst refinement).
//
// Codex's built-in image_gen.imagegen tool has no size parameter: the renderer
// infers the frame only from the prompt text. A ratio buried at the end of a
// prompt ("..., 16:9, high quality") is therefore often ignored. This module
//   1. resolves the requested format (explicit flag, --size, prompt text, or the
//      edit target's own format),
//   2. produces one unambiguous format sentence the bridge appends to the
//      imagegen prompt, and
//   3. measures the saved PNG and, when the renderer missed slightly, center-crops
//      it to the exact ratio (keeping the uncropped original), or reports a
//      mismatch it cannot fix without losing too much of the image.

import { deflateSync, inflateSync } from "node:zlib";
import * as zlib from "node:zlib";

// Ratios accepted when found as plain "W:H" text inside a prompt. A whitelist
// keeps clock times such as "18:30 Uhr" from being read as a format request.
const PROMPT_RATIO_WHITELIST = new Set([
  "1:1", "4:5", "5:4", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9", "9:21",
  "2:1", "1:2", "3:1", "1:3", "4:1", "1:4", "5:7", "7:5", "1.91:1", "1:1.91", "2.39:1",
]);

const KEYWORD_RULES = [
  { ratio: [1, 1], re: /\b(quadratisch(?:e[nrms]?)?|square(?:\s+format)?)\b/i },
  {
    ratio: [9, 16],
    re: /\b(insta(?:gram)?[\s-]*stor(?:y|ies)|story[\s-]*format|whats\s?app[\s-]*status|reels?|tik\s?tok|youtube[\s-]*shorts)\b/i,
  },
  { ratio: [16, 9], re: /\b(youtube[\s-]*thumbnail|widescreen|breitbild(?:format)?|full[\s-]*hd)\b/i },
];

const ORIENTATION_RULES = [
  {
    orientation: "portrait",
    re: /\b(hochformat|hochkant|portrait[\s-]*(?:format|orientation)|vertical[\s-]*format|vertikal(?:es)?[\s-]*format)\b/i,
  },
  {
    orientation: "landscape",
    re: /\b(querformat|landscape[\s-]*(?:format|orientation)|horizontal[\s-]*format|horizontal(?:es)?[\s-]*format)\b/i,
  },
];

const NAMED_SPECS = new Map([
  ["square", [1, 1]], ["quadratisch", [1, 1]],
  ["widescreen", [16, 9]], ["breitbild", [16, 9]],
  ["story", [9, 16]], ["reel", [9, 16]],
]);

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function num(text) {
  return Number(String(text).replace(",", "."));
}

function ratioSpec(w, h, source, extra = {}) {
  if (!(w > 0 && h > 0)) return null;
  const value = w / h;
  if (value < 0.2 || value > 5) return null;
  let label;
  if (Number.isInteger(w) && Number.isInteger(h)) {
    const g = gcd(w, h);
    const rw = w / g;
    const rh = h / g;
    label = rw <= 64 && rh <= 64 ? `${rw}:${rh}` : nearestCommonLabel(value) || `${value.toFixed(2)}:1`;
  } else {
    label = `${w}:${h}`;
  }
  return { kind: "ratio", w, h, value, label, source, ...extra };
}

// Names odd pixel sizes such as 1672x941 by the common ratio they represent.
function nearestCommonLabel(value) {
  for (const label of PROMPT_RATIO_WHITELIST) {
    const [w, h] = label.split(":").map(Number);
    if (Math.abs(value / (w / h) - 1) < 0.01) return label;
  }
  return null;
}

function orientationSpec(orientation, source) {
  return { kind: "orientation", orientation, label: orientation, source };
}

// Parses an explicit value from --aspect, --size, or a batch job field.
export function parseAspectValue(raw, source) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text || text === "auto") return null;
  if (["none", "off", "free", "frei"].includes(text)) return { kind: "disabled", label: "none", source };
  if (["portrait", "hochformat", "hochkant", "vertical", "vertikal"].includes(text)) {
    return orientationSpec("portrait", source);
  }
  if (["landscape", "querformat", "horizontal"].includes(text)) return orientationSpec("landscape", source);
  if (NAMED_SPECS.has(text)) {
    const [w, h] = NAMED_SPECS.get(text);
    return ratioSpec(w, h, source);
  }
  const pixels = text.match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})(?:\s*px)?$/);
  if (pixels && (Number(pixels[1]) >= 100 || Number(pixels[2]) >= 100)) {
    const w = Number(pixels[1]);
    const h = Number(pixels[2]);
    return ratioSpec(w, h, source, { pixels: { width: w, height: h } });
  }
  const ratio = text.match(/^(\d{1,3}(?:[.,]\d{1,3})?)\s*(?::|∶|x|×|\/|zu|to)\s*(\d{1,3}(?:[.,]\d{1,3})?)$/);
  if (ratio) return ratioSpec(num(ratio[1]), num(ratio[2]), source);
  return undefined; // not understood
}

// Finds a format request inside free prompt text. Returns null when there is none
// and { kind: "ambiguous" } when the text asks for conflicting formats.
export function detectAspectInPrompt(prompt) {
  const text = String(prompt ?? "");
  const found = new Map();
  const add = (spec) => {
    if (spec) found.set(spec.label, spec);
  };

  for (const match of text.matchAll(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*(?:px|pixel)?/gi)) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    add(ratioSpec(w, h, "prompt", { pixels: { width: w, height: h }, matched: match[0] }));
  }
  const ratioRe = /(?<![\d.,:])(\d{1,2}(?:[.,]\d{1,2})?)\s*(?::|∶|\s+zu\s+|\s+to\s+)\s*(\d{1,2}(?:[.,]\d{1,2})?)(?![\d:])/gi;
  for (const match of text.matchAll(ratioRe)) {
    const key = `${num(match[1])}:${num(match[2])}`;
    if (!PROMPT_RATIO_WHITELIST.has(key)) continue;
    add(ratioSpec(num(match[1]), num(match[2]), "prompt", { matched: match[0].trim() }));
  }
  if (found.size === 0) {
    for (const rule of KEYWORD_RULES) {
      const match = text.match(rule.re);
      if (match) add(ratioSpec(rule.ratio[0], rule.ratio[1], "prompt", { matched: match[0] }));
    }
  }
  if (found.size > 1) {
    return { kind: "ambiguous", label: [...found.keys()].join(" / "), source: "prompt" };
  }
  if (found.size === 1) return [...found.values()][0];

  const orientations = ORIENTATION_RULES.filter((rule) => rule.re.test(text));
  if (orientations.length === 1) return orientationSpec(orientations[0].orientation, "prompt");
  if (orientations.length > 1) return { kind: "ambiguous", label: "portrait / landscape", source: "prompt" };
  return null;
}

// Resolves the effective format. Priority: --aspect, --size, prompt text,
// then (for edits and variations) the edit target's own format.
export function resolveAspect({ aspect, size, prompt, mode, editTarget }) {
  if (aspect !== undefined && aspect !== null && String(aspect).trim() !== "") {
    const spec = parseAspectValue(aspect, "aspect-flag");
    if (spec === undefined) {
      throw new Error(
        `--aspect "${aspect}" is not understood. Use W:H (16:9), WxH pixels (1920x1080), square, portrait, landscape, or none.`,
      );
    }
    if (spec) return spec;
  }
  if (size && String(size).toLowerCase() !== "auto") {
    const spec = parseAspectValue(size, "size-flag");
    if (spec) return spec;
  }
  const detected = detectAspectInPrompt(prompt);
  if (detected) return detected;
  if ((mode === "edit" || mode === "variation") && editTarget?.width && editTarget?.height) {
    return ratioSpec(editTarget.width, editTarget.height, "edit-target");
  }
  return null;
}

function exampleSize(spec) {
  const long = 1536;
  if (spec.value >= 1) return `${long}×${Math.round(long / spec.value)}`;
  return `${Math.round(long * spec.value)}×${long}`;
}

// The sentence the bridge appends to the imagegen prompt. Kept in English and
// purely operational so it does not add creative direction.
export function aspectFormatSentence(spec) {
  if (!spec || spec.kind === "disabled" || spec.kind === "ambiguous") return null;
  const fill = "Fill the entire frame edge to edge; no borders, letterboxing, padding, or inset frame.";
  if (spec.kind === "orientation") {
    return spec.orientation === "portrait"
      ? `Output format: portrait orientation (the image is taller than it is wide). ${fill}`
      : `Output format: landscape orientation (the image is wider than it is tall). ${fill}`;
  }
  const keep = spec.source === "edit-target" ? " Keep the same aspect ratio as Image 1." : "";
  if (Math.abs(spec.value - 1) < 0.01) {
    return `Output format: ${spec.label} square aspect ratio (width equals height, e.g. 1024×1024 pixels).${keep} ${fill}`;
  }
  const orientation = spec.value > 1 ? "landscape" : "portrait";
  const relation = spec.value > 1
    ? `about ${spec.value.toFixed(2)} times as wide as it is tall`
    : `about ${(1 / spec.value).toFixed(2)} times as tall as it is wide`;
  return `Output format: ${spec.label} aspect ratio, ${orientation} orientation (width:height = ${spec.label}; the image is ${relation}, e.g. ${exampleSize(spec)} pixels).${keep} ${fill}`;
}

// Decides what to do with a saved image of width × height.
export function evaluateAspect(width, height, spec, { tolerance = 0.02, maxCropLoss = 0.2 } = {}) {
  const actual = width / height;
  const actualLabel = `${width}x${height} (${actual.toFixed(2)}:1)`;
  if (!spec || spec.kind === "disabled") return { status: "not_requested", actualLabel };
  if (spec.kind === "ambiguous") return { status: "ambiguous", actualLabel };
  if (spec.kind === "orientation") {
    const ok = spec.orientation === "portrait" ? height > width : width > height;
    return { status: ok ? "ok" : "mismatch", actualLabel };
  }
  const deviation = Math.abs(actual / spec.value - 1);
  if (deviation <= tolerance) return { status: "ok", actualLabel, deviation };
  let cropWidth = width;
  let cropHeight = height;
  if (actual > spec.value) cropWidth = Math.round(height * spec.value);
  else cropHeight = Math.round(width / spec.value);
  const loss = 1 - (cropWidth * cropHeight) / (width * height);
  if (loss <= maxCropLoss) return { status: "crop", actualLabel, deviation, loss, cropWidth, cropHeight };
  return { status: "mismatch", actualLabel, deviation, loss };
}

// ---------------------------------------------------------------------------
// Minimal PNG center-crop (8/16-bit, non-interlaced) without dependencies.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

let crcTable = null;
function crc32(buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer) >>> 0;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function cropPngToAspect(bytes, cropWidth, cropHeight) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Not a PNG.");
  let offset = 8;
  let ihdr = null;
  const before = [];
  const after = [];
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") ihdr = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    else (idat.length ? after : before).push({ type, data });
  }
  if (!ihdr || !idat.length) throw new Error("PNG has no IHDR or IDAT.");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported for cropping.");
  if (!(colorType in CHANNELS) || (bitDepth !== 8 && bitDepth !== 16) || (colorType === 3 && bitDepth !== 8)) {
    throw new Error(`Unsupported PNG layout for cropping (color type ${colorType}, bit depth ${bitDepth}).`);
  }
  if (cropWidth > width || cropHeight > height || cropWidth < 1 || cropHeight < 1) {
    throw new Error("Crop size exceeds the image.");
  }

  const bpp = (CHANNELS[colorType] * bitDepth) / 8;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error("PNG image data is truncated.");
  const pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = y * stride;
    const prior = y > 0 ? row - stride : -1;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[pos + i];
      const a = i >= bpp ? pixels[row + i - bpp] : 0;
      const b = prior >= 0 ? pixels[prior + i] : 0;
      const c = prior >= 0 && i >= bpp ? pixels[prior + i - bpp] : 0;
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: value = x + paeth(a, b, c); break;
        default: throw new Error(`Invalid PNG filter type ${filter}.`);
      }
      pixels[row + i] = value & 0xff;
    }
    pos += stride;
  }

  const x0 = Math.floor((width - cropWidth) / 2);
  const y0 = Math.floor((height - cropHeight) / 2);
  const outStride = cropWidth * bpp;
  const out = Buffer.alloc(cropHeight * (outStride + 1));
  const candidate = Buffer.alloc(outStride);
  let previous = Buffer.alloc(outStride);
  for (let y = 0; y < cropHeight; y += 1) {
    const start = (y0 + y) * stride + x0 * bpp;
    const current = pixels.subarray(start, start + outStride);
    let bestFilter = 0;
    let bestScore = Infinity;
    let best = null;
    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0;
      for (let i = 0; i < outStride; i += 1) {
        const a = i >= bpp ? current[i - bpp] : 0;
        const b = previous[i];
        const c = i >= bpp ? previous[i - bpp] : 0;
        const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
        const value = (current[i] - predictor) & 0xff;
        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best = Buffer.from(candidate);
      }
    }
    const rowStart = y * (outStride + 1);
    out[rowStart] = bestFilter;
    best.copy(out, rowStart + 1);
    previous = current;
  }

  const newHeader = Buffer.from(ihdr);
  newHeader.writeUInt32BE(cropWidth, 0);
  newHeader.writeUInt32BE(cropHeight, 4);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", newHeader),
    ...before.map((item) => chunk(item.type, item.data)),
    chunk("IDAT", deflateSync(out, { level: 9 })),
    ...after.map((item) => chunk(item.type, item.data)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Width and height from a baseline or progressive JPEG (SOF marker).
export function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}
