/**
 * Last-resort Proof-of-Origin token for timedtext URLs that come back empty.
 * Loaded only when a caption track exists but the transcript body is blank, so
 * a jsdom failure cannot take down the normal caption path.
 */
import { BG, GOOG_API_KEY, buildURL } from "bgutils-js";
import { JSDOM } from "jsdom";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

async function withTemporaryDom<T>(run: () => Promise<T>): Promise<T> {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://www.youtube.com/",
    pretendToBeVisual: true,
  });
  const scope = globalThis as unknown as Record<string, unknown>;
  const keys = ["window", "document", "location", "origin"] as const;
  const previous = new Map(keys.map((key) => [key, { had: key in scope, value: scope[key] }]));

  scope.window = dom.window;
  scope.document = dom.window.document;
  scope.location = dom.window.location;
  scope.origin = dom.window.origin;

  try {
    return await run();
  } finally {
    for (const key of keys) {
      const snap = previous.get(key);
      if (!snap) continue;
      if (snap.had) scope[key] = snap.value;
      else delete scope[key];
    }
    dom.window.close();
  }
}

export async function mintPoToken(visitorData: string, videoId: string): Promise<string> {
  return withTemporaryDom(async () => {
    const challenge = await BG.Challenge.create({
      fetch,
      globalObj: globalThis as unknown as Record<string, unknown>,
      requestKey: REQUEST_KEY,
      identifier: visitorData || videoId,
    });
    const interpreter = challenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!challenge || !interpreter) {
      throw new Error("YouTube did not return a caption token.");
    }

    new Function(interpreter)();
    const botguard = await BG.BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObj: globalThis as unknown as Record<string, unknown>,
    });
    const webPoSignalOutput: unknown[] = [];
    const botguardResponse = await botguard.snapshot({
      webPoSignalOutput: webPoSignalOutput as never,
    });
    const integrityResponse = await fetch(buildURL("GenerateIT", false), {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Content-Type": "application/json+protobuf",
        "x-goog-api-key": GOOG_API_KEY,
        "x-user-agent": "grpc-web-javascript/0.1",
      },
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    });
    const integrityJson = (await integrityResponse.json()) as unknown[];
    const integrityToken = integrityJson[0];
    if (!integrityResponse.ok || typeof integrityToken !== "string" || !integrityToken) {
      throw new Error("YouTube refused the caption token.");
    }
    const minter = await BG.WebPoMinter.create({ integrityToken }, webPoSignalOutput as never);
    return minter.mintAsWebsafeString(videoId);
  });
}
