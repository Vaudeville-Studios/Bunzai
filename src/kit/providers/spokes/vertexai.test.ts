/** The Service Account as the key: what is refused, and a signature Google could verify. */
import { expect, test } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readServiceAccount, signedAssertion } from "./vertexai";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = { client_email: "bot@p.iam.gserviceaccount.com", project_id: "my-project", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };

test("anything but a whole Service Account is refused, in words", () => {
  expect(() => readServiceAccount("sk-not-json")).toThrow("Service Account JSON");
  expect(() => readServiceAccount(undefined)).toThrow("Service Account JSON");
  expect(() => readServiceAccount(JSON.stringify({ client_email: "a" }))).toThrow("no client_email");
  expect(() => readServiceAccount(JSON.stringify({ ...account, project_id: "../evil" }))).toThrow("unusable project_id");
  expect(readServiceAccount(JSON.stringify(account)).project_id).toBe("my-project");
});

test("the assertion is signed RS256 for Google's fixed token address, whatever the file says", () => {
  const jwt = signedAssertion({ ...account, token_uri: "http://169.254.169.254/" } as never, 1000);
  const [head, body, signature] = jwt.split(".") as [string, string, string];
  expect(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(publicKey, signature, "base64url")).toBe(true);
  expect(JSON.parse(Buffer.from(body, "base64url").toString())).toMatchObject({ iss: account.client_email, aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 });
});
