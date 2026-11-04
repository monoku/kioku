import { test } from "node:test";
import assert from "node:assert/strict";
import { findSecrets } from "../../src/core/validate/secrets.ts";

// Shapes of credentials as they are met in notes, built from parts so that no scanner reads this file as one.
const j = (...p: string[]) => p.join("");

const CAUGHT: [string, string][] = [
  ["an AWS access key", `aws key: ${j("AKIA", "IOSFODNN7EXAMPLE")}`],
  ["a GitHub token", `token ${j("ghp_", "a".repeat(36))}`],
  ["a GitHub token", `${j("github_pat_", "A1b2".repeat(13))}`],
  ["a Slack token", `${j("xoxb-", "1234567890-abcdefghij")}`],
  ["a Stripe key", `${j("sk_live_", "abcdefghijklmnop1234")}`],
  ["a Google API key", `${j("AIza", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q")}`],
  ["a JSON web token", `${j("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "abcdefghijk")}`],
  ["a bearer token", `Authorization: Bearer ${"a1B2".repeat(8)}`],
  ["a connection string with credentials", "DATABASE_URL=postgres://app:hunter2@db.internal:5432/app"],
  ["a password or token assignment", `api_key = "${"Ab3".repeat(8)}"`],
  ["an environment variable password", `DB_PASSWORD=${"Ab3".repeat(8)}`],
  ["an environment variable api key", `export OPENAI_API_KEY="${"Ab3".repeat(8)}"`],
  ["an environment variable token", `CI_DEPLOY_TOKEN: ${"Ab3".repeat(8)}`],
  ["an environment variable secret", `STRIPE_SECRET=${"Ab3".repeat(8)}`],
  ["an AWS secret access key", `AWS_SECRET_ACCESS_KEY=${"wJalrXUtnFEMI/K7MDENG+bPxRfiCY".padEnd(40, "A")}`],
  ["a private key", `-----BEGIN ${"OPENSSH"} PRIVATE KEY-----`],
  ["a SendGrid key", j("SG.", "a1B2c3D4e5F6g7H8i9J0k1", ".", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V")],
  ["a Twilio key", j("AC", "0123456789abcdef".repeat(2))],
  ["a Mailgun key", j("key-", "0123456789abcdef".repeat(2))],
  ["a Hugging Face token", j("hf_", "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5")],
  ["a DigitalOcean token", j("dop_v1_", "0123456789abcdef".repeat(4))],
  ["a Shopify token", j("shpat_", "0123456789abcdef".repeat(2))],
  ["a PyPI token", j("pypi-", "AgEIcHlwaS5vcmc", "A1b2C3d4".repeat(8))],
  ["an Azure storage account key", j("AccountKey=", "A1b2C3d4E5f6G7h8".repeat(3), "==")],
  ["an Anthropic key, by its sk- shape", j("sk-", "ant-api03-", "A1b2C3d4E5f6G7h8I9j0")],
];

// What looks like these and is not one: a hash, an id, a word, a file name.
const NOT_SECRETS: [string, string][] = [
  ["a git commit id", "fixed in 3f786850e387550fdab836ed7e6dc881de23001b"],
  ["a uuid", "request 123e4567-e89b-12d3-a456-426614174000 failed"],
  ["a lowercase ac followed by hex", `ac${"0123456789abcdef".repeat(2)}`],
  ["a path with key-", "see config/key-rotation-runbook.md"],
  ["prose about an account key", "the AccountKey setting is in the vault, not here"],
  ["a hf_ prefix too short to be a token", "hf_cache lives in ~/.cache"],
  ["a variable that only starts with password", "PASSWORD_RESET_URL=https://example.com/account/reset-password"],
  ["a word that only ends in token", "set the TTL with tokenizer=sentencepiece_unigram_model"],
];

// Known gaps (docs/explanation/threat-model.md): each is a credential-shaped line that passes today. The test
// holds them so that closing one is a visible change, to be moved to CAUGHT, not a silent one.
const PASSES: [string, string][] = [
  ["a short password in an assignment", "password: hunter2hunter2"],
  ["a value split across two lines", `token: ${"a".repeat(10)}\n${"b".repeat(10)}`],
  ["a base64 encoded key", `config: ${Buffer.from(j("AKIA", "IOSFODNN7EXAMPLE")).toString("base64")}`],
  ["a spaced out key", `key is ${j("AKIA", "IOSFODNN7EXAMPLE").split("").join(" ")}`],
];

for (const [what, text] of CAUGHT) {
  test(`the validator sees ${what}`, () => {
    const found = findSecrets(text);
    assert.ok(found.length > 0, `not seen: ${what}`);
  });
}

for (const [what, text] of PASSES) {
  test(`known gap: ${what} is not seen`, () => {
    assert.deepEqual(findSecrets(text), []);
  });
}

for (const [what, text] of NOT_SECRETS) {
  test(`the validator leaves ${what} alone`, () => {
    assert.deepEqual(findSecrets(text), []);
  });
}
