import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const COLORS = {
  ink: [16, 32, 30, 255],
  paper: [232, 239, 238, 255],
  track: [185, 216, 208, 255],
  teal: [8, 127, 104, 255],
  mango: [240, 165, 26, 255],
  red: [187, 62, 62, 255],
};

await Promise.all([
  writeFile(new URL("../public/icons/icon-192.png", import.meta.url), makeIcon(192)),
  writeFile(new URL("../public/icons/icon-512.png", import.meta.url), makeIcon(512)),
]);

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  fill(pixels, size, COLORS.ink);
  rectangle(pixels, size, scale(64, size), scale(64, size), scale(384, size), scale(384, size), COLORS.paper);

  const rails = [176, 256, 336];
  const activeEnds = [324, 260, 354];
  for (let index = 0; index < rails.length; index += 1) {
    const y = scale(rails[index] - 12, size);
    rectangle(pixels, size, scale(112, size), y, scale(288, size), scale(24, size), COLORS.track);
    rectangle(
      pixels,
      size,
      scale(112, size),
      y,
      scale(activeEnds[index] - 112, size),
      scale(24, size),
      COLORS.teal,
    );
  }
  circle(pixels, size, scale(324, size), scale(176, size), scale(24, size), COLORS.mango);
  circle(pixels, size, scale(260, size), scale(256, size), scale(24, size), COLORS.ink);
  circle(pixels, size, scale(354, size), scale(336, size), scale(24, size), COLORS.red);

  return encodePNG(pixels, size, size);
}

function fill(pixels, size, color) {
  rectangle(pixels, size, 0, 0, size, size, color);
}

function rectangle(pixels, size, x, y, width, height, color) {
  for (let row = Math.max(0, y); row < Math.min(size, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(size, x + width); column += 1) {
      setPixel(pixels, size, column, row, color);
    }
  }
}

function circle(pixels, size, centerX, centerY, radius, color) {
  const squared = radius * radius;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const deltaX = x - centerX;
      const deltaY = y - centerY;
      if (deltaX * deltaX + deltaY * deltaY <= squared && x >= 0 && y >= 0 && x < size && y < size) {
        setPixel(pixels, size, x, y, color);
      }
    }
  }
}

function setPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function encodePNG(pixels, width, height) {
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (stride + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, row * stride, (row + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function scale(value, size) {
  return Math.round((value / 512) * size);
}
