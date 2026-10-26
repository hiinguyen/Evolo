// The user's settings (<home>/config.json), read and written by `evolo config`:
// { "review": { "language": "vi" }, "budget": { "daily-usd": "5" } }.
// Only known keys are accepted, and every value is checked both when it is set and when it is read,
// because some values (review.language) are put into the judge's instructions.
import { join } from "node:path";
import { readJson, writeJson } from "./store.mjs";

const LANGUAGE_MAX_LENGTH = 40;
const LANGUAGE_PATTERN = /^\p{L}[\p{L} -]*$/u;
const BUDGET_PATTERN = /^\d{1,4}(\.\d{1,2})?$/;
const NAME_MAX_LENGTH = 24;
const NAME_PATTERN = /^\p{L}[\p{L} ]*$/u;
const THEMES = ["system", "light", "dark"];

export const CONFIG_KEYS = {
  "review.language": {
    default: "en",
    describe: "the language reviews are written in, as a name or code (vi, Vietnamese, pt-BR)",
    check: (value) => value.length <= LANGUAGE_MAX_LENGTH && LANGUAGE_PATTERN.test(value),
    rule: `a language name or code: letters, spaces and "-", at most ${LANGUAGE_MAX_LENGTH} characters`,
  },
  "report.language": {
    default: "en",
    describe: "the language performance reviews (evolo report) are written in, as a name or code (vi, Vietnamese, pt-BR)",
    check: (value) => value.length <= LANGUAGE_MAX_LENGTH && LANGUAGE_PATTERN.test(value),
    rule: `a language name or code: letters, spaces and "-", at most ${LANGUAGE_MAX_LENGTH} characters`,
  },
  "dashboard.theme": {
    default: "system",
    describe: "the dashboard's colour theme: system follows the desktop, light or dark stays fixed",
    check: (value) => THEMES.includes(value),
    rule: `one of ${THEMES.join(", ")}`,
  },
  "dashboard.name": {
    default: "",
    describe: "the name the dashboard shows next to your rank",
    check: (value) => value === "" || (value.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(value)),
    rule: `a name of letters and spaces, at most ${NAME_MAX_LENGTH} characters, or empty`,
  },
  "budget.daily-usd": {
    default: "5",
    describe: "the most the background worker spends on the judge per local day, in USD; the rest waits for the next day",
    check: (value) => BUDGET_PATTERN.test(value) && Number(value) > 0,
    rule: "a positive amount in USD, such as 5 or 2.50",
  },
};

const configPath = (home) => join(home, "config.json");

function settingFor(key) {
  const setting = CONFIG_KEYS[key];
  if (!setting) throw new Error(`unknown setting "${key}", expected one of: ${Object.keys(CONFIG_KEYS).join(", ")}`);
  return setting;
}

function checked(key, value) {
  if (typeof value !== "string" || !settingFor(key).check(value)) {
    throw new Error(`${key} must be ${settingFor(key).rule}, got ${JSON.stringify(value)}`);
  }
  return value;
}

const readConfig = (home) => readJson(configPath(home), {});

// "review.language" -> config.review?.language
const lookup = (config, key) => key.split(".").reduce((node, part) => node?.[part], config);

export function getConfig(home, key) {
  settingFor(key);
  const value = lookup(readConfig(home), key);
  return value === undefined ? CONFIG_KEYS[key].default : checked(key, value);
}

export function setConfig(home, key, value) {
  checked(key, value);
  const config = readConfig(home);
  const [section, name] = key.split(".");
  writeJson(configPath(home), { ...config, [section]: { ...config[section], [name]: value } });
}

// Every known setting as [key, value, isDefault].
export function listConfig(home) {
  const config = readConfig(home);
  return Object.keys(CONFIG_KEYS).map((key) => {
    const value = lookup(config, key);
    return value === undefined ? [key, CONFIG_KEYS[key].default, true] : [key, checked(key, value), false];
  });
}
