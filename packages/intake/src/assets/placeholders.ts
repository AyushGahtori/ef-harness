import {
  NEUTRAL_BRAND_TOKENS,
  VISUAL_BRAND_ROLES,
  type BrandAssetRole,
  type BrandColorTokens,
} from "./limits.js";
import type { PreparedAsset } from "./brand-asset-registry.js";

export interface PlaceholderBundle {
  readonly projectName: string;
  readonly initials: string;
  readonly tokens: BrandColorTokens;
  readonly assets: Readonly<Record<(typeof VISUAL_BRAND_ROLES)[number], PreparedAsset>>;
  readonly checklist: readonly string[];
}

export class DeterministicPlaceholderGenerator {
  async generate(projectName: string, tokens: BrandColorTokens = NEUTRAL_BRAND_TOKENS): Promise<PlaceholderBundle> {
    const initials = projectInitials(projectName);
    const logoLight = monogramSvg({
      projectName,
      initials,
      background: tokens.surface,
      ink: tokens.ink,
      accent: tokens.accent,
      title: `${projectName} placeholder logo`,
    });
    const logoDark = monogramSvg({
      projectName,
      initials,
      background: tokens.ink,
      ink: tokens.surface,
      accent: tokens.muted,
      title: `${projectName} placeholder logo for dark surfaces`,
    });
    const hero = heroSvg(projectName, tokens, stableOffset(projectName));
    const avatar = avatarSvg(projectName, initials, tokens);
    const favicon = faviconSvg(projectName, initials, tokens);
    const assets = {
      logo_light: svgAsset("logo_light", logoLight, 64, 64, `${projectName} placeholder logo`, [tokens.ink, tokens.accent, tokens.surface]),
      logo_dark: svgAsset("logo_dark", logoDark, 64, 64, `${projectName} placeholder logo for dark surfaces`, [tokens.surface, tokens.ink]),
      favicon: svgAsset("favicon", favicon, 32, 32, `${projectName} placeholder favicon`, [tokens.ink, tokens.surface]),
      hero: svgAsset("hero", hero, 1200, 630, `${projectName} placeholder hero`, [tokens.surface, tokens.raised, tokens.accent]),
      avatar_fallback: svgAsset("avatar_fallback", avatar, 64, 64, `${projectName} placeholder avatar`, [tokens.ink, tokens.surface]),
    };
    return {
      projectName,
      initials,
      tokens,
      assets,
      checklist: VISUAL_BRAND_ROLES.map((role) => checklistLine(role, projectName)),
    };
  }
}

export function projectInitials(projectName: string): string {
  const words = projectName.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  const first = words[0];
  const second = words[1];
  if (!first) return "EF";
  if (!second) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function svgAsset(
  role: BrandAssetRole,
  svg: string,
  width: number,
  height: number,
  altText: string,
  colors: readonly string[],
): PreparedAsset {
  return {
    role,
    mimeType: "image/svg+xml",
    bytes: Buffer.from(svg, "utf8"),
    width,
    height,
    altText,
    dominantColorsHex: colors.map((color) => color.toUpperCase()),
    placeholder: true,
  };
}

function monogramSvg(input: {
  readonly projectName: string;
  readonly initials: string;
  readonly background: string;
  readonly ink: string;
  readonly accent: string;
  readonly title: string;
}): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">`,
    `<title>${escapeXml(input.title)}</title>`,
    `<rect width="64" height="64" rx="12" fill="${input.background}"/>`,
    `<rect x="8" y="8" width="48" height="48" fill="none" stroke="${input.accent}" stroke-width="2"/>`,
    `<text x="32" y="38" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="20" fill="${input.ink}">${escapeXml(input.initials)}</text>`,
    `</svg>`,
  ].join("");
}

function heroSvg(projectName: string, tokens: BrandColorTokens, offset: number): string {
  const shift = offset - (offset % 8);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" role="img">`,
    `<title>${escapeXml(`${projectName} placeholder hero`)}</title>`,
    `<rect width="1200" height="630" fill="${tokens.surface}"/>`,
    `<rect x="${72 + shift}" y="72" width="456" height="486" rx="16" fill="${tokens.raised}"/>`,
    `<rect x="600" y="72" width="528" height="222" rx="16" fill="${tokens.muted}"/>`,
    `<rect x="600" y="318" width="528" height="240" rx="16" fill="${tokens.accent}"/>`,
    `</svg>`,
  ].join("");
}

function avatarSvg(projectName: string, initials: string, tokens: BrandColorTokens): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">`,
    `<title>${escapeXml(`${projectName} placeholder avatar`)}</title>`,
    `<circle cx="32" cy="32" r="30" fill="${tokens.surface}" stroke="${tokens.accent}" stroke-width="2"/>`,
    `<text x="32" y="38" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="18" fill="${tokens.ink}">${escapeXml(initials)}</text>`,
    `</svg>`,
  ].join("");
}

function faviconSvg(projectName: string, initials: string, tokens: BrandColorTokens): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img">`,
    `<title>${escapeXml(`${projectName} placeholder favicon`)}</title>`,
    `<rect width="32" height="32" rx="6" fill="${tokens.surface}"/>`,
    `<rect x="4" y="4" width="24" height="24" fill="none" stroke="${tokens.accent}" stroke-width="2"/>`,
    `<text x="16" y="20" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="10" fill="${tokens.ink}">${escapeXml(initials)}</text>`,
    `</svg>`,
  ].join("");
}

function stableOffset(projectName: string): number {
  let hash = 0;
  for (const char of projectName.normalize("NFC")) {
    hash = (hash * 33 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % 24;
}

function checklistLine(role: BrandAssetRole, projectName: string): string {
  return `${role} is still a placeholder for ${projectName}. Drop the real brand file to replace it.`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
