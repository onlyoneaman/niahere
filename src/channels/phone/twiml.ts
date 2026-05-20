/** Helpers that emit Twilio Markup Language XML responses. */

function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  });
}

/**
 * TwiML that opens a bidirectional Media Stream to our WebSocket endpoint.
 * Twilio forwards `customParams` as `customParameters` in the WS `start` event,
 * which we use to attach the call's pre-built context.
 */
export function streamTwiML(wssUrl: string, customParams: Record<string, string>): string {
  const params = Object.entries(customParams)
    .map(([k, v]) => `      <Parameter name="${xmlEscape(k)}" value="${xmlEscape(v)}" />`)
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Connect>`,
    `    <Stream url="${xmlEscape(wssUrl)}">`,
    params,
    `    </Stream>`,
    `  </Connect>`,
    `</Response>`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Speak a short message and hang up — used when realtime isn't available. */
export function sayAndHangupTwiML(text: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Say>${xmlEscape(text)}</Say>`,
    `  <Hangup/>`,
    `</Response>`,
  ].join("\n");
}

/** Reject the call (Twilio counts this as not-answered — lower cost than answering and hanging up). */
export function rejectTwiML(): string {
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<Response>`, `  <Reject/>`, `</Response>`].join("\n");
}
