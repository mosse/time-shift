#!/usr/bin/env node
/**
 * Generate PWA icons from SVG
 *
 * This script creates placeholder PNG icons.
 * For production, replace with proper rendered icons from the SVG.
 *
 * Usage: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '../src/public/icons');
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// Minimal PNG header for a solid color image
// This creates a basic placeholder - replace with proper icons for production
function createPlaceholderPNG(size) {
  // Create a simple 1x1 blue PNG and note it's a placeholder
  // For a proper implementation, use sharp or canvas to render the SVG

  // Minimal valid PNG (1x1 blue pixel, will be stretched by browser)
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08, 0x02, // bit depth = 8, color type = 2 (RGB)
    0x00, 0x00, 0x00, // compression, filter, interlace
    0x90, 0x77, 0x53, 0xDE, // IHDR CRC
    0x00, 0x00, 0x00, 0x0C, // IDAT length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0xD7, 0x63, 0x38, 0x98, 0xD6, 0x00, 0x00, 0x00, 0x85, 0x00, 0x41, // compressed blue pixel
    // 0x49, 0x45, 0x4E, 0x44, // IEND
    // 0xAE, 0x42, 0x60, 0x82  // IEND CRC
  ]);

  const pngEnd = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82  // IEND CRC
  ]);

  return Buffer.concat([pngHeader, pngEnd]);
}

// Ensure icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

// Generate placeholder icons for each size
SIZES.forEach(size => {
  const filename = `icon-${size}.png`;
  const filepath = path.join(ICONS_DIR, filename);

  // Check if file already exists
  if (fs.existsSync(filepath)) {
    console.log(`Skipping ${filename} (already exists)`);
    return;
  }

  const png = createPlaceholderPNG(size);
  fs.writeFileSync(filepath, png);
  console.log(`Created ${filename}`);
});

console.log('\nPlaceholder icons created.');
console.log('For production, generate proper icons from src/public/icons/icon.svg');
console.log('You can use tools like sharp, imagemagick, or online converters.');
