import { Faker, allLocales, base, en, type LocaleDefinition } from "@faker-js/faker";
import { SYNTHETIC_REFERENCE_INSTANT } from "./types.js";

const localeTable = allLocales as Record<string, LocaleDefinition>;

export function createSeededFaker(seed: number, locale: string): Faker {
  const faker = new Faker({ locale: resolveLocales(locale) });
  faker.seed(seed);
  faker.setDefaultRefDate(SYNTHETIC_REFERENCE_INSTANT);
  return faker;
}

export function resolveLocales(locale: string): LocaleDefinition[] {
  const normalized = locale.trim().replaceAll("-", "_");
  const chain: LocaleDefinition[] = [];
  const exact = lookupLocale(normalized);
  if (exact) chain.push(exact);
  const language = lookupLocale(normalized.split("_")[0] ?? "");
  if (language && !chain.includes(language)) chain.push(language);
  if (!chain.includes(en)) chain.push(en);
  if (!chain.includes(base)) chain.push(base);
  return chain;
}

function lookupLocale(code: string): LocaleDefinition | undefined {
  if (!code) return undefined;
  if (Object.prototype.hasOwnProperty.call(localeTable, code)) {
    return localeTable[code];
  }
  return undefined;
}
