
const sharp = require("sharp");
const path = require("path");

const outputDir = __dirname;

async function createIcon(size, filename) {
    const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 192 192"
         xmlns="http://www.w3.org/2000/svg">
      <rect width="192" height="192" rx="36" fill="#1E2D4B"/>

      <rect x="35" y="35" width="122" height="122"
            rx="22" fill="none" stroke="white" stroke-width="7"/>

      <path d="M58 119 L85 91 L106 105 L139 64"
            fill="none" stroke="#5ADCAA" stroke-width="10"
            stroke-linecap="round" stroke-linejoin="round"/>

      <path d="M118 64 L139 64 L139 85"
            fill="none" stroke="#5ADCAA" stroke-width="10"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    await sharp(Buffer.from(svg))
        .resize(size, size)
        .png()
        .toFile(path.join(outputDir, filename));

    console.log(`Created ${filename}: ${size}x${size}`);
}

async function main() {
    await createIcon(192, "color.png");
    await createIcon(32, "outline.png");
}

main().catch(console.error);
