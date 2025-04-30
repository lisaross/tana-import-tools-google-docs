import { google, drive_v3 as GoogleDriveV3, docs_v1 as GoogleDocsV1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "fs/promises";
import * as path from "path";
import * as http from "http";
import open from "open";
import { fileURLToPath } from "url";

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are set.
// Obtain these from the Google Cloud Console: https://console.cloud.google.com/apis/credentials
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth2callback"; // Must match console config

const TOKEN_PATH = path.join(__dirname, "token.json");
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
];

let oauth2Client: OAuth2Client | null = null;

// Re-export types to avoid TS4060
export type DriveClientType = GoogleDriveV3.Drive;
export type DocsClientType = GoogleDocsV1.Docs;

/**
 * Reads previously authorized credentials from the save file.
 */
async function loadTokenIfExists(): Promise<OAuth2Client | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables not set. Authentication might fail.");
    // Optionally throw an error here if credentials are required upfront
    // throw new Error("Missing Google API credentials in environment variables.");
  }
  try {
    const content = await fs.readFile(TOKEN_PATH, "utf8");
    const credentials = JSON.parse(content);
    // Ensure client ID/secret match the token, though library might handle mismatch
    const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    client.setCredentials(credentials);
    oauth2Client = client;
    return client;
  } catch (err) {
    // If token file doesn't exist or is invalid, return null
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 */
async function saveCredentials(client: OAuth2Client): Promise<void> {
  if (!client.credentials) {
    throw new Error("Client has no credentials to save.");
  }
  try {
    await fs.writeFile(TOKEN_PATH, JSON.stringify(client.credentials));
    console.log("Token stored to", TOKEN_PATH);
  } catch (error) {
      console.error("Error saving token:", error);
  }
}

/**
 * Authenticates the user using OAuth 2.0 flow.
 */
export async function authenticate(): Promise<OAuth2Client | null> { // Return null on failure
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables must be set.");
    return null; // Cannot proceed without credentials
  }

  const loadedClient = await loadTokenIfExists();
  if (loadedClient) {
    try {
      // Attempt to get an access token, which may trigger a refresh
      const tokenInfo = await loadedClient.getAccessToken();
      if (tokenInfo.token) {
          console.log("Using existing token.");
          return loadedClient;
      } else {
          console.log("Existing token loaded but failed to get access token, re-authenticating...");
      }
    } catch (error: any) {
      console.log(`Token refresh needed or failed (${error.message}), re-authenticating...`);
      // Fall through to re-authentication if refresh fails
    }
  }

  // If no valid token, start the auth flow
  return new Promise((resolve, reject) => {
    const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const authorizeUrl = client.generateAuthUrl({
      access_type: "offline", // Request refresh token
      scope: SCOPES,
      prompt: "consent", // Force consent screen for refresh token
    });

    console.log("-------------------------------------------------------------------");
    console.log("Authorization Required: Please open the following URL in your browser:");
    console.log(authorizeUrl);
    console.log("-------------------------------------------------------------------");

    const server = http
      .createServer(async (req, res) => {
        try {
          if (req.url?.includes("/oauth2callback")) {
            const qs = new URL(req.url, REDIRECT_URI).searchParams;
            const code = qs.get("code");
            if (!code) {
              const error = qs.get("error") || "No code received";
              res.end(`Authentication failed: ${error}. Please try again.`);
              server.close();
              return reject(new Error(`Authentication failed: ${error}`));
            }
            console.log(`Authorization code received.`);
            res.end("Authentication successful! You can close this browser window.");
            server.close();

            const { tokens } = await client.getToken(code);
            client.setCredentials(tokens);
            console.log("Access and refresh tokens received.");
            await saveCredentials(client);
            oauth2Client = client;
            resolve(client);
          } else {
            res.writeHead(404);
            res.end("Not Found");
          }
        } catch (e: any) {
          console.error("Error during OAuth callback:", e);
          res.writeHead(500);
          res.end("Authentication failed due to server error.");
          server.close();
          reject(e);
        }
      })
      .listen(3000, () => {
        // Try to open the authorization URL in the user's browser
        open(authorizeUrl, { wait: false }).catch((err) =>
          console.warn("Failed to automatically open browser. Please copy the URL above manually.", err)
        );
        console.log("Waiting for authorization callback on http://localhost:3000/oauth2callback ...");
      });

    server.on("error", (err) => {
      console.error("Local callback server error:", err);
      // Attempt to provide a more helpful message for common errors like EADDRINUSE
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          console.error("Port 3000 is already in use. Please stop the other process or configure a different port.");
      }
      reject(err);
    });
  });
}

export function getDriveClient(auth: OAuth2Client): DriveClientType {
  return google.drive({ version: "v3", auth });
}

export function getDocsClient(auth: OAuth2Client): DocsClientType {
  return google.docs({ version: "v1", auth });
}

