/** Tests exact HTTPS-origin and host-selected connection destination policy. */
import { describe, expect, test } from "bun:test";
import { isPolicyDestination, isPublicHttpsOrigin } from "../contracts/destination";

describe("extension destination policy", () => {
  test("allows only exact public HTTPS origins and opaque host connections", () => {
    expect(isPublicHttpsOrigin("https://api.example.com")).toBe(true);
    expect(isPublicHttpsOrigin("https://api.example.com/path")).toBe(false);
    expect(isPublicHttpsOrigin("http://api.example.com")).toBe(false);
    expect(isPublicHttpsOrigin("https://localhost")).toBe(false);
    expect(isPublicHttpsOrigin("https://127.0.0.1")).toBe(false);
    expect(isPublicHttpsOrigin("https://[::1]")).toBe(false);
    expect(isPolicyDestination("approved-public-https", "https://api.example.com")).toBe(true);
    expect(isPolicyDestination("host-selected-connection", "connection:provider.active")).toBe(true);
    expect(isPolicyDestination("host-selected-connection", "https://api.example.com")).toBe(false);
    expect(isPolicyDestination("none", "https://api.example.com")).toBe(false);
  });
});
