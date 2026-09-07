const OPENAI_AUTHORIZATION_ORIGIN = "https://auth.openai.com";
const OPENAI_AUTHORIZATION_PATH = "/oauth/authorize";

/**
 * Accept only the authorization endpoint emitted by OpenClaw's OpenAI OAuth
 * flow. The returned value is normalized for safe handoff to a browser.
 */
export function validateOpenAiAuthorizationUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());

    if (
      url.origin !== OPENAI_AUTHORIZATION_ORIGIN ||
      url.protocol !== "https:" ||
      url.pathname !== OPENAI_AUTHORIZATION_PATH ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !url.search
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
