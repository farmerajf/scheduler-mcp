import https from "https";
import type { PushoverConfig } from "./config.js";

interface PushoverMessage {
  title: string;
  message: string;
}

export async function sendNotification(
  config: PushoverConfig,
  msg: PushoverMessage
): Promise<void> {
  const body = new URLSearchParams({
    token: config.appToken,
    user: config.userKey,
    title: msg.title,
    message: msg.message,
  }).toString();

  return new Promise((resolve) => {
    const req = https.request(
      "https://api.pushover.net/1/messages.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            console.error(`Pushover error: ${res.statusCode} ${data}`);
          }
          resolve();
        });
      }
    );
    req.on("error", (err) => {
      console.error(`Pushover request error: ${err.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}
